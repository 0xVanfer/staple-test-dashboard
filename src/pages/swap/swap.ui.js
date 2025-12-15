/**
 * @file swap.ui.js
 * @description This module handles the rendering of UI components for the Swap page.
 * It includes functions for:
 * - Populating token selection dropdowns.
 * - Rendering the list of enumerated swap paths.
 * - Displaying detailed information about Virtual Trading Pairs (VTPs).
 * - Showing estimation results, fees, and potential errors.
 * - Updating the execution area with current swap context.
 *
 * This module is purely presentational and relies on data provided by `swap.main.js`.
 */
// Dependencies: src/lib/common.js
(function(){
  // Prevent re-initialization if the module is already loaded
  if (window.swapUI) return;

  // Access common utility functions
  const COMMON = window.stapleCommon || {};

  /**
   * @function optionLabel
   * @private
   * @description Generates a formatted label for a token option in a dropdown.
   * Format: "SYMBOL (Address...)"
   *
   * @param {Object} meta - Token metadata object containing `symbol` and `address`.
   * @returns {string} The formatted label string.
   */
  function optionLabel(meta){
    return `${meta.symbol || '???'} (${meta.address.slice(0,6)}...${meta.address.slice(-4)})`;
  }

  /**
   * @function renderTokenSelect
   * @description Populates a `<select>` element with token options.
   * It sorts the tokens alphabetically by symbol.
   *
   * @param {HTMLElement} selectEl - The select element to populate.
   * @param {Object} tokenSymbols - Map of token metadata objects.
   */
  function renderTokenSelect(selectEl, tokenSymbols){
    if (!selectEl) return;
    selectEl.innerHTML = '';
    
    // Sort tokens by symbol for better user experience
    const metas = Object.values(tokenSymbols).sort((a,b)=> (a.symbol||'').localeCompare(b.symbol||''));
    
    metas.forEach(m=>{
      const opt=document.createElement('option');
      opt.value = m.address;
      opt.textContent = optionLabel(m);
      selectEl.appendChild(opt);
    });
  }

  /**
   * @function vtpBasicInfo
   * @private
   * @description Extracts basic information from a VTP object for display.
   * Includes ID, parameters (n, p), assets, and Asset-Liability Ratios (ALR).
   *
   * @param {Object} v - The VTP object.
   * @returns {Object} An object containing extracted properties.
   */
  function vtpBasicInfo(v){
    const id = v?.params?.id;
    const n = v?.params?.n;
    const p = v?.params?.p;
    const a0 = v?.token0?.params?.asset;
    const a1 = v?.token1?.params?.asset;
    
    // Convert BigNumbers to numbers for display, defaulting to 0 if invalid
    const alr0 = Number(COMMON.fromBigNumber(v?.token0?.status?.alr,18)) || 0;
    const alr1 = Number(COMMON.fromBigNumber(v?.token1?.status?.alr,18)) || 0;
    
    // Calculate Relative ALR (rALR)
    const ralr = (alr1>0 && alr0>0) ? (alr0/alr1) : 0;
    
    return { id, n, p, a0, a1, alr0, alr1, ralr };
  }

  /**
   * @function tokenExtra
   * @private
   * @description Extracts detailed status information for a single token within a VTP.
   * Includes liability, ALR, and swap fees.
   *
   * @param {Object} vtptoken - The token object within the VTP.
   * @param {Object} tokenDecimals - Map of token decimals.
   * @returns {Object} An object containing formatted token details.
   */
  function tokenExtra(vtptoken, tokenDecimals){
    const asset = vtptoken?.params?.asset;
    const d = tokenDecimals[asset?.toLowerCase()] ?? 18;
    return {
      asset,
      decimals: d,
      liability: COMMON.fromBigNumber(vtptoken?.status?.liability, d),
      alr: COMMON.fromBigNumber(vtptoken?.status?.alr, 18),
      feeIn: COMMON.fromBigNumber(vtptoken?.params?.swapFeeIn, 6),
      feeOut: COMMON.fromBigNumber(vtptoken?.params?.swapFeeOut, 6),
    };
  }

  /**
   * @function bnToStr
   * @private
   * @description Helper to convert a BigNumber to a readable string with specified decimals.
   * Falls back to string conversion if formatting fails.
   *
   * @param {ethers.BigNumber} bn - The BigNumber to convert.
   * @param {number} decimals - The number of decimals.
   * @returns {string} The formatted string.
   */
  function bnToStr(bn, decimals){
    try { return COMMON.fromBigNumber(bn, decimals); } catch { return String(bn); }
  }

  /**
   * @function buildVtpDetail
   * @private
   * @description Constructs the HTML for displaying detailed information about a single VTP in a path.
   * It includes static parameters and, if available, dynamic estimation results for the specific hop.
   *
   * @param {Object} v - The VTP object.
   * @param {Object} tokenSymbols - Map of token symbols.
   * @param {Object} tokenDecimals - Map of token decimals.
   * @param {Object} process - The estimation process result for this hop (optional).
   * @param {Object} hopCtx - Context for the hop (input/output assets, symbols, decimals).
   * @returns {HTMLElement} The constructed DOM element.
   */
  function buildVtpDetail(v, tokenSymbols, tokenDecimals, process, hopCtx){
    const basic = vtpBasicInfo(v);
    const t0 = tokenExtra(v.token0, tokenDecimals);
    const t1 = tokenExtra(v.token1, tokenDecimals);
    const wrap = document.createElement('div');
    wrap.className = 'vtp-detail';
    
    // Basic VTP Info
    wrap.innerHTML =
      `<div class="kv">
         <div>ID: ${basic.id}</div>
         <div>n: ${basic.n}</div>
         <div>p: ${basic.p}</div>
         <div>pa: ${bnToStr(v.status.pa,18)}</div>
         <div>ralr: ${basic.ralr.toFixed(6)}</div>
       </div>
       <div class="kv">
         <div>T0: ${tokenSymbols[t0.asset?.toLowerCase()]?.symbol || ''} (d=${t0.decimals})</div>
         <div>liability: ${t0.liability||'-'}</div>
         <div>alr: ${t0.alr||'-'}</div>
         <div>feeIn: ${t0.feeIn||'-'}</div>
         <div>feeOut: ${t0.feeOut||'-'}</div>
       </div>
       <div class="kv">
         <div>T1: ${tokenSymbols[t1.asset?.toLowerCase()]?.symbol || ''} (d=${t1.decimals})</div>
         <div>liability: ${t1.liability||'-'}</div>
         <div>alr: ${t1.alr||'-'}</div>
         <div>feeIn: ${t1.feeIn||'-'}</div>
         <div>feeOut: ${t1.feeOut||'-'}</div>
       </div>`;
       
    // If there is a valuation process (estimation result), append it
    if (process && hopCtx){
      const inD = hopCtx.inDec;
      const outD = hopCtx.outDec;
      let pa = Number(bnToStr(v.status.pa,18));
      
      // Normalize price direction based on input asset
      if (v.token1.params.asset.toLowerCase() == hopCtx.inAsset.toLowerCase()){ pa = 1/pa; }

      const estHTML =
        `<div class="kv" style="margin-top:6px;">
          <div style="font-weight:600;">Valuation</div>
          <div>in(${COMMON.escapeHtml(hopCtx.inSym)}): ${bnToStr(process.amountIn, inD)}</div>
          <div>feeIn: ${bnToStr(process.feeIn, inD)}</div>
          <div>realIn: ${bnToStr(process.realIn, inD)}</div>
          <div>swapGet: ${bnToStr(process.swapGet, outD)}</div>
          <div>feeOut: ${bnToStr(process.feeOut, outD)}</div>
          <div>estiOut: ${bnToStr(process.estiOut, outD)}</div>
          <div>punish: ${bnToStr(process.punishment, outD)}${process.isPunishment ? ' (Y)' : ''}</div>
          <div>realOut(${COMMON.escapeHtml(hopCtx.outSym)}): ${bnToStr(process.realOut, outD)}</div>
          <div>pa: ${pa}</div>
          <div>slippage: ${10000-10000*Number(bnToStr(process.realOut, outD)/(Number(bnToStr(process.amountIn, inD))*pa))} bps</div>
        </div>`;
      wrap.insertAdjacentHTML('beforeend', estHTML);
    }
    return wrap;
  }

  /**
   * @function renderEnumeratedPaths
   * @description Renders the list of all possible swap paths found.
   * Highlights the best path and the currently selected path.
   *
   * @param {HTMLElement} container - The container element.
   * @param {Array} paths - Array of path objects (arrays of VTPs).
   * @param {string} fromAsset - Source asset address.
   * @param {string} toAsset - Destination asset address.
   * @param {Object} tokenSymbols - Map of token symbols.
   * @param {Array} outputs - Array of estimated outputs for each path (optional).
   * @param {number} bestIndex - Index of the best path.
   * @param {number} selectedIndex - Index of the currently selected path.
   */
  function renderEnumeratedPaths(container, paths, fromAsset, toAsset, tokenSymbols, outputs=[], bestIndex=-1, selectedIndex=-1){
    if (!container) return;
    if (!paths.length){
      container.innerHTML = '<div class="placeholder">No feasible path</div>';
      return;
    }
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    const fromSym = tokenSymbols[fromAsset.toLowerCase()]?.symbol || 'FROM';
    const toSym = tokenSymbols[toAsset.toLowerCase()]?.symbol || 'TO';
    
    paths.forEach((path, idx)=>{
      const item = document.createElement('div');
      item.className = 'path-item';
      item.dataset.index = idx;
      
      if (idx === bestIndex) item.classList.add('best');
      if (idx === selectedIndex) item.classList.add('selected');
      
      const ids = path.map(v=> v?.params?.id).join(' / ');
      
      // Construct the path string (e.g., "ETH => (USDC/ETH) => USDC")
      const chainStr = [fromSym, ...path.map(v=>{
        const a0 = v?.token0?.params?.asset;
        const a1 = v?.token1?.params?.asset;
        const s0 = tokenSymbols[a0?.toLowerCase()]?.symbol || (a0||'').slice(0,6);
        const s1 = tokenSymbols[a1?.toLowerCase()]?.symbol || (a1||'').slice(0,6);
        return `(${s0}/${s1})`;
      }), toSym].join(' => ');
      
      const outDisp = outputs[idx] != null ? `<span class="badge">Out: ${outputs[idx]}</span>` : '';
      
      item.innerHTML = `<div class="path-head">
          <span class="assets">${chainStr}</span>
          <span class="badge">Len: ${path.length}</span>
          ${outDisp}
          <span class="badge">IDs: ${ids}</span>
        </div>`;
      frag.appendChild(item);
    });
    container.appendChild(frag);
  }

  /**
   * @function renderVtpDetails
   * @description Renders detailed information for all VTPs in a selected path.
   * It iterates through the path segments and calls `buildVtpDetail` for each.
   *
   * @param {HTMLElement} detailEl - The container element.
   * @param {Array} vtps - Array of VTP objects in the path.
   * @param {Object} tokenSymbols - Map of token symbols.
   * @param {Object} tokenDecimals - Map of token decimals.
   * @param {Array} processes - Array of estimation process results (optional).
   * @param {string} fromAsset - Source asset address.
   * @param {string} toAsset - Destination asset address.
   */
  function renderVtpDetails(detailEl, vtps, tokenSymbols, tokenDecimals, processes, fromAsset, toAsset){
    if (!detailEl) return;
    detailEl.innerHTML = '';
    if (!Array.isArray(vtps) || !vtps.length){
      detailEl.innerHTML = '<div class="placeholder">No details</div>';
      return;
    }
    
    // Build per-hop context (direction and precision)
    let curr = (fromAsset||'').toLowerCase();
    const frag = document.createDocumentFragment();
    
    vtps.forEach((v, idx)=>{
      const a0 = v?.token0?.params?.asset?.toLowerCase();
      const a1 = v?.token1?.params?.asset?.toLowerCase();
      const next = (a0===curr) ? a1 : a0;
      const inAsset = curr;
      const outAsset = next;
      const inSym = tokenSymbols[inAsset]?.symbol || (inAsset||'').slice(0,6);
      const outSym = tokenSymbols[outAsset]?.symbol || (outAsset||'').slice(0,6);
      const inDec = tokenDecimals[inAsset] ?? 18;
      const outDec = tokenDecimals[outAsset] ?? 18;
      const hopCtx = { inAsset, outAsset, inSym, outSym, inDec, outDec };
      const proc = Array.isArray(processes) ? processes[idx] : null;
      
      frag.appendChild(buildVtpDetail(v, tokenSymbols, tokenDecimals, proc, hopCtx));
      curr = next;
    });
    detailEl.appendChild(frag);
  }

  /**
   * @function renderBestPath
   * @description Renders the summary of the best path found.
   *
   * @param {HTMLElement} summaryEl - The summary container element.
   * @param {HTMLElement} detailEl - The details container element.
   * @param {Object} best - The best path object containing output, VTPs, etc.
   * @param {Object} tokenSymbols - Map of token symbols.
   * @param {string} fromAsset - Source asset address.
   * @param {string} toAsset - Destination asset address.
   * @param {Object} tokenDecimals - Map of token decimals.
   * @param {Array} processes - Array of estimation process results.
   */
  function renderBestPath(summaryEl, detailEl, best, tokenSymbols, fromAsset, toAsset, tokenDecimals, processes){
    if (!summaryEl) return;
    if (!best){
      summaryEl.innerHTML = '<div style="color:rgba(255,255,255,0.7);font-size:14px;">Select tokens to see routes</div>';
      if (detailEl) detailEl.innerHTML = '';
      return;
    }
    const { estiOut, pathVtps, fromReadable, toReadable } = best;
    const fromSym = fromReadable;
    const toSym = toReadable;
    
    const chain = [fromSym, ...pathVtps.map(v=>{
      const a0=v?.token0?.params?.asset; const a1=v?.token1?.params?.asset;
      const s0 = tokenSymbols[a0?.toLowerCase()]?.symbol || a0?.slice(0,6);
      const s1 = tokenSymbols[a1?.toLowerCase()]?.symbol || a1?.slice(0,6);
      return `(${s0}/${s1})`;
    }), toSym].join(' ➜ ');
    
    summaryEl.innerHTML =
      `<div class="path-item best" data-best="1">
         <div class="path-head">
           <div class="assets" style="font-size:18px;margin-bottom:12px;font-weight:700;">${chain}</div>
           <div style="display:flex;gap:10px;flex-wrap:wrap;">
             <span class="badge" style="font-size:15px;padding:6px 12px;">📊 Output: ${estiOut}</span>
             <span class="badge" style="padding:6px 12px;">Hops: ${pathVtps.length}</span>
             <span class="badge" style="padding:6px 12px;">VTP IDs: ${pathVtps.map(v=>v?.params?.id).join(', ')}</span>
           </div>
         </div>
       </div>`;
    
    // Render details in the expandable section
    if (detailEl) {
      renderVtpDetails(detailEl, pathVtps, tokenSymbols, tokenDecimals, processes||[], fromAsset, toAsset);
    }
  }

  /**
   * @function renderEstimateError
   * @description Displays or clears an error message in the details area.
   *
   * @param {HTMLElement} detailEl - The details container element.
   * @param {string} msg - The error message to display. If empty, clears the error.
   */
  function renderEstimateError(detailEl, msg){
    if (!detailEl) return;
    // Clear existing error messages in this container
    detailEl.querySelectorAll('#error-box, .estimate-error').forEach(n=> n.remove());
    if (!msg) return;
    const div = document.createElement('div');
    div.id = 'error-box';
    div.className = 'estimate-error';
    div.textContent = msg;
    detailEl.prepend(div);
  }

  /**
   * @function renderExecuteArea
   * @description Renders the execution area with current swap details and execute button.
   * Note: The main execution button logic is now handled in `swap.main.js`, this is for the detailed view.
   *
   * @param {HTMLElement} el - The container element.
   * @param {Object} ctx - The execution context.
   */
  function renderExecuteArea(el, ctx){
    if (!el){ return; }
    if (!ctx){
      el.innerHTML = '<div class="placeholder">No executable data</div>';
      return;
    }
    const { chainStr, amountInReadable, estiOutReadable, disabledReason } = ctx;
    el.innerHTML = `
      <div class="swap-exec">
        <div style="flex:1;min-width:260px;">
          <div>Current Path: ${COMMON.escapeHtml(chainStr)}</div>
          <div>Input: ${COMMON.escapeHtml(amountInReadable)}</div>
          <div>Estimated Output: ${COMMON.escapeHtml(estiOutReadable)}</div>
        </div>
        <label>Slippage(%)</label>
        <input id="swap-slippage" type="text" value="1">
        <button id="swap-exec-btn" ${disabledReason ? 'disabled' : ''}>Execute</button>
        <span id="swap-exec-msg" style="font-size:12px;color:${disabledReason?'#b91c1c':'#666'};">${COMMON.escapeHtml(disabledReason||'')}</span>
      </div>
    `;
  }

  // Expose the module API globally
  window.swapUI = {
    renderTokenSelect,
    renderEnumeratedPaths,
    renderBestPath,
    renderVtpDetails,
    renderEstimateError,
    renderExecuteArea,
  };
})();

