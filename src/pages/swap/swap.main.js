/**
 * @file swap.main.js
 * @description This is the main controller for the Swap page functionality.
 * It orchestrates the entire swap process, including:
 * - Initializing and refreshing pool and token data.
 * - Handling user inputs for token selection and amount.
 * - Calculating the best swap paths using the `UIPoolDataProvider` contract.
 * - Estimating swap outputs and fees using the `Controller` contract.
 * - Managing the UI state for path selection and execution.
 * - Executing the actual swap transaction via the `Router` contract.
 *
 * This module relies on several global dependencies:
 * - `window.environment`: For configuration and user context.
 * - `window.swapGraph`: For building the graph of pools and enumerating paths.
 * - `window.swapUI`: For rendering UI components.
 * - `window.contractData`: For centralized data fetching.
 * - `window.RpcManager`: For rate-limited RPC calls.
 */

(async function(){
  // Wait for environment to be ready
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (window.environment && window.contractData && window.swapGraph && window.swapUI) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  // Global dependencies
  const env = window.environment;
  const graph = window.swapGraph;
  const ui = window.swapUI;
  const debounce = (window.stapleCommon && window.stapleCommon.debounce) || (fn=>fn);

  // Cache data structure to store pool and token information
  let dataCache = null;   // { allVtps, assetAdj, tokenSymbols, tokenDecimals }
  let poolsCache = null;
  // State for storing calculated paths and their details
  // Simplified: no longer saving outBN for each path immediately
  let pathsState = [];        // [{pathVtps, pathIds}]
  
  // Index of the "best" path (usually highest output or shortest)
  let bestIndex = -1;
  
  // Index of the currently selected path by the user
  let selectedIndex = -1;
  
  // Context for the currently selected swap operation
  // Contains all necessary data to execute the swap
  let selectedSwapContext = null; // { from,to,pathIds,amountInBN,estiOutBN,fromDec,toDec,amountInReadable,processes? }

  /**
   * @async
   * @function waitForPools
   * @description Polls for pool data until it becomes available or a timeout is reached.
   * This is useful during initial load if the data isn't immediately ready.
   *
   * @param {number} [timeoutMs=10000] - Maximum time to wait in milliseconds.
   * @param {number} [intervalMs=300] - Interval between checks in milliseconds.
   * @returns {Promise<Array>} The array of pools, or an empty array if timed out.
   */
  async function waitForPools(timeoutMs=10000, intervalMs=300){
    const start=Date.now();
    while(Date.now()-start<timeoutMs){
      try {
        const p = await window.contractData.getPools();
        if (Array.isArray(p)) return p;
      } catch {}
      await new Promise(r=>setTimeout(r, intervalMs));
    }
    return [];
  }

  /**
   * @async
   * @function collectTokenDecimals
   * @description Fetches decimal precision for a list of tokens using pool-derived metadata only.
   * No contract calls are made; falls back to 18 when pool data is missing.
   *
   * @param {Object} tokenSymbols - Map of token addresses to symbol objects.
   * @param {Map<string, number>} fallbackDecimals - Optional map of decimals derived from pool data.
   * @returns {Promise<Object>} A map of token addresses (lowercase) to their decimal values.
   */
  async function collectTokenDecimals(tokenSymbols, fallbackDecimals = new Map()){
    const tokenDecimals = {};
    const addrs = Object.values(tokenSymbols).map(o=>o.address);

    addrs.forEach(addr => {
      const lower = addr.toLowerCase();
      const fallbackDec = fallbackDecimals.has(lower) ? Number(fallbackDecimals.get(lower)) : null;
      tokenDecimals[lower] = Number.isFinite(fallbackDec) ? fallbackDec : 18;
    });
    return tokenDecimals;
  }

  function buildDecimalsFromPools(pools){
    const map = new Map();
    (pools||[]).forEach(p=>{
      const vtps = Array.isArray(p?.relatedVtps) ? p.relatedVtps : [];
      vtps.forEach(v=>{
        const a0 = v?.token0?.params?.asset;
        const d0 = v?.token0?.params?.decimals;
        if (a0) map.set(a0.toLowerCase(), Number(d0 ?? 18));
        const a1 = v?.token1?.params?.asset;
        const d1 = v?.token1?.params?.decimals;
        if (a1) map.set(a1.toLowerCase(), Number(d1 ?? 18));
      });
    });
    return map;
  }

  function buildTokenSymbolsFromEnvCache(pools){
    const tokenSymbols = {};
    const symbolsCache = (()=>{ try { return window.environment?.getSymbols() || {}; } catch { return {}; }})();
    (pools||[]).forEach(p=>{
      const vtps = Array.isArray(p?.relatedVtps) ? p.relatedVtps : [];
      vtps.forEach(v=>{
        const addrs = [v?.token0?.params?.asset, v?.token1?.params?.asset].filter(Boolean);
        addrs.forEach(addr=>{
          const lower = addr.toLowerCase();
          if (!tokenSymbols[lower]) {
            const sym = symbolsCache[lower] || addr.slice(0,6);
            tokenSymbols[lower] = { address: addr, symbol: sym };
          }
        });
      });
    });
    return tokenSymbols;
  }

  /**
   * @async
   * @function refreshData
   * @description Refreshes the core data needed for the swap page.
   * 1. Fetches the latest list of pools.
   * 2. Builds the graph data structure using `swapGraph`.
   * 3. Fetches token decimals from pool-derived metadata only (no direct on-chain symbol/decimals calls).
   * 4. Updates the `dataCache`.
   * 5. Repopulates the token selection dropdowns.
   */
  async function refreshData(){
    poolsCache = await window.contractData.getPools();
    if (!Array.isArray(poolsCache) || !poolsCache.length) {
      // Fallback to polling wait (initial load might not be ready)
      poolsCache = await waitForPools();
    }
    if (!poolsCache.length) console.warn('[swap] No pools fetched');
    const decimalsFallback = buildDecimalsFromPools(poolsCache);
    
    // Build the graph from the pool data
    let base = await graph.buildData(poolsCache, env);
    if (!base) {
      console.warn('[swap] buildData failed');
      base = { allVtps: new Map(), assetAdj: new Map(), tokenSymbols: {} };
    }

    // If graph metadata is empty, fall back to environment cache to keep the selects populated
    const tokenSymbols = Object.keys(base.tokenSymbols || {}).length
      ? base.tokenSymbols
      : buildTokenSymbolsFromEnvCache(poolsCache);
    
    // Collect decimals for all tokens involved in the pools
    const tokenDecimals = await collectTokenDecimals(tokenSymbols, decimalsFallback);
    
    dataCache = { ...base, tokenSymbols, tokenDecimals };
    populateSelects();
  }

  /**
   * @function populateSelects
   * @description Populates the "From" and "To" token dropdowns with available tokens.
   * It attempts to preserve the user's current selection if possible.
   */
  function populateSelects(){
    if (!dataCache) return;
    const { tokenSymbols } = dataCache;
    
    // Store current selections before repopulating to restore them later
    const fromEl = document.getElementById('swap-from');
    const toEl = document.getElementById('swap-to');
    const prevFrom = fromEl?.value || '';
    const prevTo = toEl?.value || '';
    
    // Render the options using the UI helper
    ui.renderTokenSelect(fromEl, tokenSymbols);
    ui.renderTokenSelect(toEl, tokenSymbols);
    
    // Restore previous selections if they still exist in the new list
    if (fromEl && prevFrom && fromEl.querySelector(`option[value="${prevFrom}"]`)) {
      fromEl.value = prevFrom;
    }
    if (toEl && prevTo && toEl.querySelector(`option[value="${prevTo}"]`)) {
      toEl.value = prevTo;
    }
    
    // Set default selections if nothing was selected or restored
    if (fromEl && toEl && fromEl.options.length > 1) {
      if (!prevFrom || !fromEl.value) {
        fromEl.selectedIndex = 0; // Select first option if nothing selected
      }
      if (!prevTo || !toEl.value) {
        // Select a different token for "To" than "From"
        if (toEl.selectedIndex === fromEl.selectedIndex && toEl.options.length > 1) {
          toEl.selectedIndex = (fromEl.selectedIndex + 1) % toEl.options.length;
        }
      }
    }
  }

  /**
   * @function enumeratePathsOnly
   * @description Enumerates all possible swap paths between the selected "From" and "To" assets.
   * It uses the graph traversal logic with a maximum depth (hop count) of 3.
   *
   * @returns {Array} An array of paths, where each path is an array of VTPs (Virtual Trading Pairs).
   */
  function enumeratePathsOnly(){
    const fromAsset = document.getElementById('swap-from')?.value;
    const toAsset = document.getElementById('swap-to')?.value;
    if (!dataCache || !fromAsset || !toAsset) return [];
    const { assetAdj } = dataCache;
    
    // Find paths with max depth 3
    const paths = graph.enumeratePaths(fromAsset, toAsset, assetAdj, 3) || [];
    
    // Sort paths by length (shortest first)
    paths.sort((a,b)=> a.length - b.length);
    return paths;
  }

  /**
   * @function parseAmountInput
   * @description Parses the user's input amount string into a BigNumber, considering token decimals.
   *
   * @param {string} amountStr - The amount as a string.
   * @param {number} decimals - The number of decimals for the token.
   * @returns {ethers.BigNumber} The parsed amount as a BigNumber.
   */
  function parseAmountInput(amountStr, decimals){
    try { return ethers.utils.parseUnits(String(amountStr||'0'), decimals); } catch { return ethers.BigNumber.from(0); }
  }

  /**
   * @function pickOtherAsset
   * @description Given a VTP (Virtual Trading Pair) and one asset, returns the other asset in the pair.
   *
   * @param {Object} vtp - The Virtual Trading Pair object.
   * @param {string} currentAsset - The address of the known asset.
   * @returns {string|null} The address of the other asset, or null if not found.
   */
  function pickOtherAsset(vtp, currentAsset) {
    const a0 = vtp?.token0?.params?.asset;
    const a1 = vtp?.token1?.params?.asset;
    if (!a0 || !a1) return null;
    const c = (currentAsset||'').toLowerCase();
    if (a0.toLowerCase() === c) return a1;
    if (a1.toLowerCase() === c) return a0;
    return null;
  }

  /**
   * @function derivePoolIDIn
   * @description Determines the Pool ID associated with the input asset for a given VTP.
   * This is required for the `estimateSwap` function call.
   *
   * @param {Object} vtp - The Virtual Trading Pair object.
   * @param {string} inAsset - The address of the input asset.
   * @returns {string|null} The normalized Pool ID, or null if not found.
   */
  function derivePoolIDIn(vtp, inAsset){
    const a0 = vtp?.token0?.params?.asset;
    const a1 = vtp?.token1?.params?.asset;
    const id0 = vtp?.token0?.params?.id;
    const id1 = vtp?.token1?.params?.id;
    const inL = (inAsset||'').toLowerCase();
    if (a0 && a0.toLowerCase()===inL) return graph.normalizeId(id0);
    if (a1 && a1.toLowerCase()===inL) return graph.normalizeId(id1);
    return null;
  }

  /**
   * @async
   * @function estimateSelectedPathAndRender
   * @description Estimates the output of the currently selected swap path by simulating it hop-by-hop.
   * It calls the `estimateSwap` function on the Controller contract for each segment of the path.
   * It updates the UI with the estimation results and any errors encountered.
   */
  async function estimateSelectedPathAndRender(){
    const bestDetailEl = document.getElementById('best-path-detail');
    const execEl = document.getElementById('execute-area');
    if (!selectedSwapContext || selectedIndex<0 || !pathsState[selectedIndex]) return;

    // Clear previous errors in the UI
    ui.renderEstimateError(bestDetailEl, '');

    // Get the Controller contract instance
    const controller = await (window.contracts && window.contracts.getController && window.contracts.getController())
      .catch(()=>null);
    
    if (!controller || !controller.estimateSwap){
      // Estimation unavailable, show error and render params only
      ui.renderEstimateError(bestDetailEl, 'Estimation unavailable (Controller missing or estimateSwap not supported)');
      const { tokenSymbols, tokenDecimals } = dataCache || {};
      const vtps = pathsState[selectedIndex].pathVtps;
      ui.renderVtpDetails(bestDetailEl, vtps, tokenSymbols, tokenDecimals, [], selectedSwapContext.from, selectedSwapContext.to);
      ui.renderExecuteArea(execEl, {
        chainStr: chainString(vtps, tokenSymbols, selectedSwapContext.from, selectedSwapContext.to),
        amountInReadable: selectedSwapContext.amountInReadable,
        estiOutReadable: '-',
        disabledReason: 'Estimation unavailable'
      });
      return;
    }

    const userAddr = (env && env.getAllParams) ? (env.getAllParams().user || ethers.constants.AddressZero) : ethers.constants.AddressZero;
    const now = Math.floor(Date.now()/1000);
    const feeDiscount = 0;

    const vtps = pathsState[selectedIndex].pathVtps;
    const processes = [];
    const errors = [];
    let currAsset = selectedSwapContext.from;
    let currAmount = selectedSwapContext.amountInBN;
    
    // Note: We iterate through the path segments sequentially because the output of one swap
    // determines the input amount for the next. Parallel execution is not possible here without
    // a specialized multicall contract that supports value chaining.
    for (let i=0; i<vtps.length; i++){
      const v = vtps[i];
      const nextAsset = pickOtherAsset(v, currAsset);
      const poolIDIn = derivePoolIDIn(v, currAsset);
      const vtpID = graph.normalizeId(v?.params?.id);
      
      if (!nextAsset || poolIDIn==null || vtpID==null){
        processes.push(null);
        errors.push(`Path segment ${i+1} direction or ID invalid`);
        currAmount = ethers.BigNumber.from(0);
        currAsset = nextAsset;
        continue;
      }
      
      const input = {
        deadline: now + 300,
        vtpID,
        poolIDIn,
        amountIn: currAmount,
        owner: userAddr,
        receiver: userAddr,
        feeDiscount
      };
      
      let proc = null;
      try {
        // Use RpcManager for rate limiting and potential batching (though sequential here)
        let res;
        if (window.RpcManager) {
            res = await window.RpcManager.call(controller, 'estimateSwap', [input]);
        } else {
            throw new Error('RpcManager required');
        }
        proc = res?.process || res || null;
      } catch (e) {
        proc = null;
        errors.push(`Path segment ${i+1} estimation failed: ${e?.message || String(e)}`);
      }
      
      processes.push(proc);
      
      // Update current amount for the next hop
      try {
        currAmount = proc?.realOut ? ethers.BigNumber.from(proc.realOut) : ethers.BigNumber.from(0);
      } catch { currAmount = ethers.BigNumber.from(0); }
      currAsset = nextAsset;
    }

    // Show errors (if any)
    ui.renderEstimateError(bestDetailEl, errors.length ? errors.join(' | ') : '');

    // Use last segment estiOut as final output
    let estiOutBN = ethers.BigNumber.from(0);
    const lastProc = processes[processes.length-1];
    try { if (lastProc?.realOut) estiOutBN = ethers.BigNumber.from(lastProc.realOut); } catch {}

    // Update the global context with the estimation results
    selectedSwapContext.processes = processes;
    selectedSwapContext.estiOutBN = estiOutBN;

    // Render details (params + estimation)
    const { tokenSymbols, tokenDecimals } = dataCache || {};
    ui.renderVtpDetails(bestDetailEl, vtps, tokenSymbols, tokenDecimals, processes, selectedSwapContext.from, selectedSwapContext.to);

    // Render execute area (update main button state)
    updateExecuteButton();
  }

  /**
   * @async
   * @function recompute
   * @description The core logic for recalculating swap paths and estimates when inputs change.
   * 1. Validates inputs (From, To, Amount).
   * 2. Enumerates all possible paths.
   * 3. Calls `UIPoolDataProvider.calcBetterPath` to find the optimal path and estimated output.
   * 4. Updates `pathsState` and selects the best path.
   * 5. Renders the path list and summary.
   * 6. Triggers detailed estimation for the selected path.
   */
  async function recompute(){
    const fromAsset = document.getElementById('swap-from')?.value;
    const toAsset = document.getElementById('swap-to')?.value;
    const amountStr = document.getElementById('swap-amount')?.value || '0';
    const bestSummaryEl = document.getElementById('best-path-summary');
    const bestDetailEl = document.getElementById('best-path-detail');
    const execEl = document.getElementById('execute-area');
    
    if (!fromAsset || !toAsset){
      bestSummaryEl.innerHTML = '<div class="placeholder">Select assets</div>';
      bestDetailEl.innerHTML = '';
      execEl.innerHTML = '<div class="placeholder">Select assets</div>';
      return;
    }
    if (!dataCache){
      bestSummaryEl.innerHTML = '<div class="placeholder">Data not ready</div>';
      return;
    }
    
    const { tokenDecimals, tokenSymbols } = dataCache;
    const fromDec = tokenDecimals[fromAsset.toLowerCase()] ?? 18;
    const toDec = tokenDecimals[toAsset.toLowerCase()] ?? 18;
    const amountInBN = parseAmountInput(amountStr, fromDec);
    const amountInReadable = (()=> { try { return ethers.utils.formatUnits(amountInBN, fromDec);} catch {return amountStr;} })();

    // Avoid RPC-heavy path calculations until the user enters a positive amount
    if (!amountStr.trim() || amountInBN.lte(0)) {
      const listEl = document.getElementById('all-paths');
      listEl.innerHTML = '<div class="placeholder">Enter amount to compute paths</div>';
      bestSummaryEl.innerHTML = '<div class="placeholder">Enter amount to compute paths</div>';
      bestDetailEl.innerHTML = '';
      execEl.innerHTML = '<div class="placeholder">Enter amount to compute paths</div>';
      pathsState = [];
      selectedSwapContext = null;
      updateExecuteButton();
      return;
    }

    const rawPaths = enumeratePathsOnly();
    const listEl = document.getElementById('all-paths');
    
    if (!rawPaths.length){
      listEl.innerHTML = '<div class="placeholder">No valid path</div>';
      bestSummaryEl.innerHTML = '<div class="placeholder">No valid path</div>';
      bestDetailEl.innerHTML = '';
      execEl.innerHTML = '<div class="placeholder">No valid path</div>';
      pathsState = [];
      selectedSwapContext = null;
      return;
    }

    const uiPool = await window.contracts.getUiPoolDataProvider();
    if (!uiPool || !uiPool.calcBetterPath){
      bestSummaryEl.innerHTML = '<div class="placeholder">UIPool missing calcBetterPath</div>';
      return;
    }

    // Prepare Path IDs for the contract call
    const allPathIds = rawPaths.map(path => path.map(v=> graph.normalizeId(v.params.id)));
    
    // Call calcBetterPath to get best path and estimated output
    let bestOutBN = ethers.BigNumber.from(0);
    let bestPathIds = [];
    try {
      // Use RpcManager for rate limiting
      let res;
      if (window.RpcManager) {
          res = await window.RpcManager.call(uiPool, 'calcBetterPath', [fromAsset, amountInBN, allPathIds, 0]);
      } else {
          throw new Error('RpcManager required');
      }
      
      // Handle potential tuple/object return formats
      const realOut = res?.realOut ?? res?.[0] ?? 0;
      const path = res?.path ?? res?.[1] ?? [];
      bestOutBN = ethers.BigNumber.from(realOut);
      bestPathIds = (path||[]).map(n=> Number(n));
    } catch(e){
      console.warn('[swap] calcBetterPath failed', e);
    }

    // Build pathsState for internal tracking
    pathsState = rawPaths.map(p=> ({ pathVtps: p, pathIds: p.map(v=> graph.normalizeId(v.params.id)) }));

    // Determine the index of the best path returned by the contract
    const keyOf = (ids)=> ids.join('-');
    const bestKey = keyOf(bestPathIds);
    bestIndex = pathsState.findIndex(p=> keyOf(p.pathIds) === bestKey);
    if (bestIndex < 0) {
      // Fallback: select the first path (usually shortest) if matching fails
      bestIndex = 0;
    }

    // Only provide output value for the best path in the list view initially
    const outReadableArr = pathsState.map((p,i)=>{
      if (i!==bestIndex) return undefined;
      try { return ethers.utils.formatUnits(bestOutBN, toDec); } catch { return '0'; }
    });

    // Default selection is the best path
    selectedIndex = bestIndex;
    buildSelectedContext(amountInBN, amountInReadable, fromAsset, toAsset, fromDec, toDec);
    selectedSwapContext.estiOutBN = bestOutBN; // Use bestPath rough estimate first, refresh with detailed estimate later

    // Render all enumerated paths
    ui.renderEnumeratedPaths(listEl, rawPaths, fromAsset, toAsset, tokenSymbols, outReadableArr, bestIndex, selectedIndex);

    // Render best path summary
    const bestObj = pathsState[bestIndex];
    ui.renderBestPath(
      bestSummaryEl,
      bestDetailEl,
      {
        estiOut: outReadableArr[bestIndex] || '0',
        pathVtps: bestObj.pathVtps,
        fromReadable: tokenSymbols[fromAsset.toLowerCase()]?.symbol || 'FROM',
        toReadable: tokenSymbols[toAsset.toLowerCase()]?.symbol || 'TO'
      },
      tokenSymbols,
      fromAsset,
      toAsset,
      tokenDecimals,
      [] // processes estimation filled later
    );

    // Render execute area (use rough estimate first)
    renderExecuteAreaFromContext();

    // Bind click events for path selection
    bindPathSelection(listEl, {
      amountInBN, amountInReadable, fromAsset, toAsset, fromDec, toDec
    }, tokenSymbols);

    // Allow clicking the best path summary to re-select it
    bestSummaryEl.querySelector('.path-item')?.addEventListener('click', ()=>{
      if (bestIndex>=0){
        selectedIndex = bestIndex;
        buildSelectedContext(amountInBN, amountInReadable, fromAsset, toAsset, fromDec, toDec);
        renderExecuteAreaFromContext(); // Show basic first
        estimateSelectedPathAndRender(); // Then supplement estimation and details
        markSelection(listEl);
      }
    });

    // Perform detailed hop-by-hop estimation for the selected path
    await estimateSelectedPathAndRender();
    
    // Update main execute button state
    updateExecuteButton();
  }

  /**
   * @function updateExecuteButton
   * @description Updates the state and text of the main "Swap" button based on the current context.
   * It handles enabling/disabling the button and formatting the label with amounts and symbols.
   */
  function updateExecuteButton(){
    const btn = document.getElementById('btn-execute-swap');
    if (!btn) return;

    // Check for Zero Address / No User
    const userAddr = (env && env.getAllParams) ? env.getAllParams().user : null;
    const isNoUser = !userAddr || userAddr === ethers.constants.AddressZero || userAddr === "0x0000000000000000000000000000000000000000";

    if (isNoUser) {
      btn.disabled = true;
      btn.textContent = 'Connect Wallet / Select User';
      btn.style.background = '#cbd5e1';
      btn.style.cursor = 'not-allowed';
      return;
    }
    
    if (!selectedSwapContext || !selectedSwapContext.estiOutBN || selectedSwapContext.estiOutBN.eq(0)) {
      btn.disabled = true;
      btn.textContent = 'Select tokens to swap';
      btn.style.background = '#cbd5e1';
      btn.style.cursor = 'not-allowed';
      return;
    }
    
    const { tokenSymbols } = dataCache || {};
    const { from, to, amountInReadable, estiOutBN, toDec } = selectedSwapContext;
    const fromSym = tokenSymbols?.[from?.toLowerCase()]?.symbol || 'Token';
    const toSym = tokenSymbols?.[to?.toLowerCase()]?.symbol || 'Token';
    const estiOutReadable = (()=>{ try { return ethers.utils.formatUnits(estiOutBN||0, toDec);} catch { return '0'; } })();
    
    btn.disabled = false;
    btn.textContent = `Swap ${amountInReadable} ${fromSym} → ${estiOutReadable} ${toSym}`;
    btn.style.background = '';
    btn.style.cursor = 'pointer';
  }

  /**
   * @function buildSelectedContext
   * @description Constructs the `selectedSwapContext` object based on the currently selected path index.
   * This context object is used throughout the module to track the state of the pending swap.
   *
   * @param {ethers.BigNumber} amountInBN - Input amount.
   * @param {string} amountInReadable - Input amount as a readable string.
   * @param {string} fromAsset - Address of the input asset.
   * @param {string} toAsset - Address of the output asset.
   * @param {number} fromDec - Decimals of the input asset.
   * @param {number} toDec - Decimals of the output asset.
   */
  function buildSelectedContext(amountInBN, amountInReadable, fromAsset, toAsset, fromDec, toDec){
    if (selectedIndex<0 || !pathsState[selectedIndex]) { selectedSwapContext = null; return; }
    const entry = pathsState[selectedIndex];
    selectedSwapContext = {
      from: fromAsset,
      to: toAsset,
      pathIds: entry.pathIds,
      amountInBN,
      estiOutBN: ethers.BigNumber.from(0),
      fromDec,
      toDec,
      amountInReadable,
      processes: []
    };
  }

  /**
   * @function chainString
   * @description Generates a string representation of the swap path (e.g., "ETH => (USDC/ETH) => USDC").
   *
   * @param {Array} pathVtps - Array of VTPs in the path.
   * @param {Object} tokenSymbols - Map of token symbols.
   * @param {string} fromAsset - Input asset address.
   * @param {string} toAsset - Output asset address.
   * @returns {string} The formatted path string.
   */
  function chainString(pathVtps, tokenSymbols, fromAsset, toAsset){
    const fromSym = tokenSymbols[fromAsset.toLowerCase()]?.symbol || 'FROM';
    const toSym = tokenSymbols[toAsset.toLowerCase()]?.symbol || 'TO';
    return [fromSym, ...pathVtps.map(v=>{
      const a0=v?.token0?.params?.asset, a1=v?.token1?.params?.asset;
      const s0 = tokenSymbols[a0?.toLowerCase()]?.symbol || (a0||'').slice(0,6);
      const s1 = tokenSymbols[a1?.toLowerCase()]?.symbol || (a1||'').slice(0,6);
      return `(${s0}/${s1})`;
    }), toSym].join(' => ');
  }

  /**
   * @function renderExecuteAreaFromContext
   * @description Updates the execution area UI.
   * Currently delegates to `updateExecuteButton` as the main action is now on the button.
   */
  function renderExecuteAreaFromContext(){
    // Execute functionality moved to main button
    // This function is kept for compatibility but delegates to the new button updater
    updateExecuteButton();
  }

  /**
   * @function bindPathSelection
   * @description Binds click events to the path list items.
   * When a path is clicked, it updates the selection, re-estimates, and updates the UI.
   *
   * @param {HTMLElement} listEl - The container element for the path list.
   * @param {Object} ctx - The current swap context (amounts, assets, decimals).
   * @param {Object} tokenSymbols - Map of token symbols.
   */
  function bindPathSelection(listEl, ctx, tokenSymbols){
    listEl.addEventListener('click', async e=>{
      const item = e.target.closest('.path-item');
      if (!item || !item.dataset.index) return;
      const idx = Number(item.dataset.index);
      if (!pathsState[idx]) return;
      selectedIndex = idx;
      buildSelectedContext(ctx.amountInBN, ctx.amountInReadable, ctx.fromAsset, ctx.toAsset, ctx.fromDec, ctx.toDec);
      renderExecuteAreaFromContext(); // Use empty estimation first
      await estimateSelectedPathAndRender(); // Re-estimate and show error/details
      markSelection(listEl);
    });
  }

  /**
   * @function markSelection
   * @description Visually highlights the currently selected path in the list.
   *
   * @param {HTMLElement} listEl - The container element for the path list.
   */
  function markSelection(listEl){
    listEl.querySelectorAll('.path-item').forEach(el=>{
      el.classList.toggle('selected', Number(el.dataset.index) === selectedIndex);
    });
  }

  /**
   * @function calcMinOut
   * @description Calculates the minimum output amount based on the estimated output and user-defined slippage.
   *
   * @param {ethers.BigNumber} estiOutBN - The estimated output amount.
   * @returns {ethers.BigNumber} The minimum acceptable output amount.
   */
  function calcMinOut(estiOutBN){
    const slipStr = document.getElementById('custom-slippage')?.value || '0.3';
    let s = Number(slipStr);
    if (!(s>=0 && s<100)) s = 0.3;
    const denom = ethers.BigNumber.from(10000);
    const factor = denom.sub(ethers.BigNumber.from(Math.floor(s*100)));
    return estiOutBN.mul(factor).div(denom);
  }

  /**
   * @async
   * @function ensureApprove
   * @description Checks if the user has approved the spender to spend the required amount of tokens.
   * If not, it initiates an approval transaction.
   * Handles USDT-like tokens that require resetting allowance to 0 first.
   *
   * @param {string} tokenAddr - The token address.
   * @param {string} spender - The address authorized to spend the tokens (usually the LP).
   * @param {ethers.BigNumber} amountBN - The amount to approve.
   * @param {string} userAddr - The user's address.
   * @throws {Error} If the approval fails.
   */
  async function ensureApprove(tokenAddr, spender, amountBN, userAddr) {
    if (!tokenAddr || !spender || amountBN.lte(0)) return;
    try {
      // If userAddr is not provided, try to get it from env
      if (!userAddr) userAddr = env.getAllParams().user;
      
      const signer = await window.stapleCommon.resolveSigner(userAddr);
      if (!signer) {
        alert('Please set private key in settings for Production mode');
        throw new Error('No signer available');
      }
      const erc20 = new ethers.Contract(tokenAddr, erc20MetadataAbi, signer);
      
      // Check current allowance
      const allowance = await erc20.allowance(userAddr, spender);
      
      // If allowance is insufficient, trigger approve transaction
      if (allowance.lt(amountBN)) {
        // USDT-like safe approve: if allowance > 0, must reset to 0 first
        if (allowance.gt(0)) {
            console.log('[swap] Resetting allowance to 0 for safe approve...');
            try {
                const tx0 = await erc20.approve(spender, 0);
                await tx0.wait();
            } catch (e) {
                console.warn('[swap] Reset allowance failed (might not be needed for this token)', e);
                // Continue to try normal approve, as some tokens might revert on 0 approve or just failed for other reasons
            }
        }
        
        console.log('[swap] Approving amount:', amountBN.toString());
        const tx = await erc20.approve(spender, amountBN);
        await tx.wait();
      }
    } catch (e) {
      console.warn('[swap] approve failed', e);
      throw e;
    }
  }

  /**
   * @async
   * @function executeSwap
   * @description Executes the swap transaction.
   * 1. Validates the swap context and user inputs.
   * 2. Checks for router availability.
   * 3. Calculates minimum output with slippage.
   * 4. Generates verification data (if required).
   * 5. Ensures token approval.
   * 6. Sends the swap transaction to the Router contract.
   * 7. Handles success/failure notifications and UI updates.
   */
  async function executeSwap(){
    const msgEl = document.getElementById('swap-exec-msg');
    const btn = document.getElementById('btn-execute-swap');
    let originalBtnText = '';
    
    function setMsg(t,c){ if(msgEl){ msgEl.textContent=t; msgEl.style.color=c||'#666'; } }
    
    // Save original button text and disable button
    if (btn) {
      originalBtnText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Swapping...';
      btn.style.background = '#cbd5e1';
      btn.style.cursor = 'not-allowed';
    }
    
    // Helper function to restore button state
    function restoreButton() {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalBtnText;
        btn.style.background = '';
        btn.style.cursor = 'pointer';
      }
    }
    
    // Helper function to show popup notification
    function showNotification(message, type = 'success') {
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        z-index: 10000;
        font-size: 15px;
        font-weight: 500;
        animation: slideInRight 0.3s ease-out;
        max-width: 400px;
      `;
      notification.textContent = message;
      
      // Add animation keyframes if not exists
      if (!document.querySelector('#swap-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'swap-notification-styles';
        style.textContent = `
          @keyframes slideInRight {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }
      
      document.body.appendChild(notification);
      
      // Auto remove after 5 seconds
      setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
      }, 5000);
    }
    
    const userAddr = env.getAllParams().user;
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddr||'')){ setMsg('Invalid user address','red'); restoreButton(); return; }

    // Check for signer (Private Key in Prod)
    const signer = await window.stapleCommon.resolveSigner(userAddr);
    if (!signer) {
      alert('Please set private key in settings for Production mode');
      setMsg('Missing Private Key', 'red');
      restoreButton();
      return;
    }

    const router = await window.contracts.getRouter(userAddr).catch(e=>{ console.warn(e); return null; });
    if (!router){ setMsg('Router unavailable','red'); restoreButton(); return; }

    const { from, to, pathIds, amountInBN, estiOutBN, toDec, fromDec } = selectedSwapContext;
    const minOutBN = calcMinOut(estiOutBN);

    // Build verification data for the price provider if needed
    let verifyData = '0x';
    try {
      const tokenSet = new Set([from, to]);
      const { allVtps } = dataCache || {};
      pathIds.forEach(id=>{
        const v = allVtps?.get(id);
        if (v?.token0?.params?.asset) tokenSet.add(v.token0.params.asset);
        if (v?.token1?.params?.asset) tokenSet.add(v.token1.params.asset);
      });
      if (window.buildPriceProviderVerificationPayload) {
        verifyData = await window.buildPriceProviderVerificationPayload(Array.from(tokenSet));
      }
    } catch(e){
      console.warn('[swap] build verifyData failed', e);
    }

    // Determine the spender address for approval
    // The spender is the LP address of the first pool in the path
    const firstVtp = dataCache?.allVtps?.get(pathIds[0]);
    let spender = null;
    if (firstVtp?.token0?.params?.asset === from) {
        spender = firstVtp?.token0?.params?.lpAddr;
    } else {
        spender = firstVtp?.token1?.params?.lpAddr;
    }

    try {
      if (btn) btn.textContent = 'Approving...';
      await ensureApprove(from, spender, amountInBN, userAddr);
      console.log('[swap] approve ok:  ', { token: from, spender, amount: amountInBN.toString() });
    } catch {
      setMsg('Approve failed','red');
      showNotification('❌ Approve failed', 'error');
      restoreButton();
      return;
    }

    const deadline = Math.floor(Date.now()/1000)+300;
    const swapInput = {
      deadline,
      receiver: userAddr,
      tokenIn: from,
      tokenOut: to,
      path: pathIds,
      amountIn: amountInBN,
      amountOutMin: minOutBN
    };

    if (btn) btn.textContent = 'Sending Tx...';
    setMsg('Sending...', '#2563eb');
    try {
      const tx = await router.swap(swapInput, verifyData);
      if (btn) btn.textContent = 'Confirming...';
      await tx.wait();
      
      // Format amounts for notification
      const { tokenSymbols } = dataCache || {};
      const fromSym = tokenSymbols?.[from?.toLowerCase()]?.symbol || 'Token';
      const toSym = tokenSymbols?.[to?.toLowerCase()]?.symbol || 'Token';
      const amountInFormatted = ethers.utils.formatUnits(amountInBN, fromDec);
      const amountOutFormatted = ethers.utils.formatUnits(estiOutBN, toDec);
      
      setMsg('Swap successful', '#16a34a');
      showNotification(`✅ Swap successful! ${amountInFormatted} ${fromSym} → ${amountOutFormatted} ${toSym}`, 'success');
      
      // Restore button before refresh
      restoreButton();
      
      // Refresh data and UI after successful swap
      await refreshData();
      await recompute();
      document.dispatchEvent(new Event('pool:refresh'));
    } catch(e){
      console.warn('[swap] swap failed', e);
      const errorMsg = e?.message || 'Unknown error';
      setMsg('Failed: ' + errorMsg, 'red');
      showNotification('❌ Swap failed: ' + errorMsg, 'error');
      restoreButton();
    }
  }

  /**
   * @function bindEvents
   * @description Binds global event listeners for the swap page.
   * - Input changes (From, To, Amount) trigger recomputation.
   * - Execute button triggers the swap.
   * - Swap direction button toggles inputs.
   */
  function bindEvents(){
    const fromEl = document.getElementById('swap-from');
    const toEl = document.getElementById('swap-to');
    const amtEl = document.getElementById('swap-amount');
    const execBtn = document.getElementById('btn-execute-swap');
    const swapDirBtn = document.getElementById('btn-swap-direction');
    
    const deb = debounce(()=> {
      selectedSwapContext = null;
      recompute();
    }, 500);
    
    fromEl?.addEventListener('change', deb);
    toEl?.addEventListener('change', deb);
    amtEl?.addEventListener('input', deb);
    amtEl?.addEventListener('keydown', e=> { if (e.key==='Enter') recompute(); });
    
    // Bind execute button
    execBtn?.addEventListener('click', executeSwap);
    
    // Bind swap direction button - swap from/to selections
    swapDirBtn?.addEventListener('click', () => {
      if (!fromEl || !toEl) return;
      const fromValue = fromEl.value;
      const toValue = toEl.value;
      const amountValue = amtEl?.value || '';
      
      // Swap the selections
      fromEl.value = toValue;
      toEl.value = fromValue;
      
      // Clear amount when swapping to avoid confusion
      if (amtEl) amtEl.value = '';
      
      // Trigger recompute
      selectedSwapContext = null;
      recompute();
    });
  }

  /**
   * @async
   * @function init
   * @description Initializes the module by fetching data and performing an initial computation.
   */
  async function init(){
    await refreshData();
    await recompute();
  }

  // Initialize on DOMContentLoaded and refresh on 'pool:refresh' events
  document.addEventListener('DOMContentLoaded', ()=>{
    init();
    bindEvents();
  });
  document.addEventListener('pool:refresh', ()=>{ init(); });

  // Fallback: some refresh paths load this script after DOMContentLoaded fired (e.g., cached reload or late defer), so kick off init/bind once if the document is already interactive/complete.
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    init();
    bindEvents();
  }

})();

