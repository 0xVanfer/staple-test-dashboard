/**
 * Swap Calculator UI Logic
 * Handles loading data, user interactions, and displaying results
 */
// Dependencies: src/lib/common.js, src/lib/contractCalls.js, src/pages/environment/environment.js, src/pages/calc/swapCalculator.js
(async function() {
  'use strict';

  // Wait for dependencies
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (window.contractData && window.environment && window.swapCalculator && window.contracts) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  // Ensure environment is ready (contracts initialized)
  if (window.environment.refreshPoolInfo) {
      try {
          // Trigger a refresh if needed to ensure contracts are loaded
          // We don't force it, just ensure the mechanism is ready
          // Actually, getPools will handle it, but we want to make sure _uiPoolContract is ready
          // The best way is to rely on getPools which now handles initialization
      } catch(e) {}
  }

  const env = window.environment;
  const calc = window.swapCalculator;
  const COMMON = window.stapleCommon || {};

  function getEnvSymbols() {
    try {
      if (env && typeof env.getSymbols === 'function') return env.getSymbols();
      if (window.environment && typeof window.environment.getSymbols === 'function') return window.environment.getSymbols();
    } catch (e) {
      console.warn('[swap-calc] getSymbols failed', e);
    }
    return {};
  }

  function truncateAddr(addr) {
    if (typeof addr !== 'string') return '';
    return addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
  }

  function pickSymbol(addr, symbolCache = null) {
    if (!addr) return '';
    const cache = symbolCache || getEnvSymbols();
    const lower = addr.toLowerCase();
    return cache[lower] || cache[addr] || truncateAddr(addr);
  }

  let allVtps = [];
  let selectedVtp = null;
  let fromToken = null;
  let toToken = null;

  /**
   * Load all VTPs from contract data
   */
  async function loadVtps() {
    try {
      const pools = await window.contractData.getPools();
      allVtps = [];
      const vtpIds = new Set();
      
      for (const pool of pools) {
        if (Array.isArray(pool.relatedVtps)) {
          for (const vtp of pool.relatedVtps) {
            if (vtp && vtp.params && vtp.params.id !== undefined && !vtpIds.has(vtp.params.id)) {
              allVtps.push(vtp);
              vtpIds.add(vtp.params.id);
            }
          }
        }
      }

      console.log('[Swap Calculator] Loaded', allVtps.length, 'VTPs');
      return allVtps;
    } catch (e) {
      console.error('[Swap Calculator] Failed to load VTPs:', e);
      return [];
    }
  }

  /**
   * Populate VTP dropdown
   */
  async function populateVtpDropdown() {
    const select = document.getElementById('swap-vtp-select');
    if (!select) return;

    select.innerHTML = '<option value="">Loading...</option>';
    
    const vtps = await loadVtps();
    
    if (vtps.length === 0) {
      select.innerHTML = '<option value="">No VTPs available</option>';
      return;
    }

    select.innerHTML = '<option value="">Select a VTP...</option>';
    
    // Batch fetch symbols from environment cache only
    const assets = [];
    for (const vtp of vtps) {
      if (vtp?.token0?.params?.asset) assets.push(vtp.token0.params.asset);
      if (vtp?.token1?.params?.asset) assets.push(vtp.token1.params.asset);
    }
    const uniqueAssets = [...new Set(assets)];
    const envSymbols = getEnvSymbols();
    const symbolMap = {};

    uniqueAssets.forEach(addr => {
      const lower = addr.toLowerCase();
      symbolMap[addr] = envSymbols[lower] || envSymbols[addr] || truncateAddr(addr);
    });

    for (let i = 0; i < vtps.length; i++) {
      const vtp = vtps[i];
      const vtpId = vtp?.params?.id;
      const asset0 = vtp?.token0?.params?.asset;
      const asset1 = vtp?.token1?.params?.asset;
      
      const symbol0 = symbolMap[asset0] || truncateAddr(asset0) || 'Token0';
      const symbol1 = symbolMap[asset1] || truncateAddr(asset1) || 'Token1';
      
      const option = document.createElement('option');
      option.value = i;
      option.textContent = `VTP ${vtpId}: ${symbol0} / ${symbol1}`;
      
      // Check liquidity for styling
      const assets0 = parseFloat(COMMON.fromBigNumber ? COMMON.fromBigNumber(vtp.token0?.status?.assets || '0', vtp.token0?.params?.decimals || 18) : (vtp.token0?.status?.assets || '0'));
      const assets1 = parseFloat(COMMON.fromBigNumber ? COMMON.fromBigNumber(vtp.token1?.status?.assets || '0', vtp.token1?.params?.decimals || 18) : (vtp.token1?.status?.assets || '0'));
      
      if (assets0 > 0 && assets1 > 0) {
          option.style.backgroundColor = '#f0fdf4'; // Very light green
          option.textContent += ' (Liquidity OK)';
      } else {
          option.style.backgroundColor = '#fef2f2'; // Very light red
          option.textContent += ' (No Liquidity)';
      }

      select.appendChild(option);
    }
  }

  /**
   * Handle VTP selection
   */
  function onVtpSelected(index) {
    if (index === '' || index < 0 || index >= allVtps.length) {
      selectedVtp = null;
      document.getElementById('swap-direction').innerHTML = '<option value="">Select VTP first...</option>';
      document.getElementById('vtp-params-display').style.display = 'none';
      const calcActions = document.getElementById('calc-actions');
      if (calcActions) calcActions.style.display = 'none';
      return;
    }

    selectedVtp = allVtps[index];
    console.log('[Swap Calculator] Selected VTP:', selectedVtp);

    // Populate direction dropdown
    populateDirectionDropdown();

    // Show parameters section
    document.getElementById('vtp-params-display').style.display = 'block';
    const calcActions = document.getElementById('calc-actions');
    if (calcActions) calcActions.style.display = 'block';
    
    // Load initial direction (0)
    onDirectionSelected('0');
  }

  /**
   * Populate direction dropdown based on operation type
   */
  function populateDirectionDropdown() {
      if (!selectedVtp) return;
      
      const directionSelect = document.getElementById('swap-direction');
      const opType = document.getElementById('calc-operation-type').value;
      const currentVal = directionSelect.value;
      
      directionSelect.innerHTML = '';
      
        const asset0 = selectedVtp?.token0?.params?.asset;
        const asset1 = selectedVtp?.token1?.params?.asset;
        const s0 = pickSymbol(asset0);
        const s1 = pickSymbol(asset1);

        const option0 = document.createElement('option');
        option0.value = '0';

        const option1 = document.createElement('option');
        option1.value = '1';

        if (opType === 'swap') {
          option0.textContent = `Sell ${s0} → Buy ${s1}`;
          option1.textContent = `Sell ${s1} → Buy ${s0}`;
        } else if (opType === 'allocate') {
          option0.textContent = `Allocate ${s0}`;
          option1.textContent = `Allocate ${s1}`;
        } else if (opType === 'deallocate') {
          option0.textContent = `Deallocate ${s0}`;
          option1.textContent = `Deallocate ${s1}`;
        }

        directionSelect.appendChild(option0);
        directionSelect.appendChild(option1);

        // Restore selection if valid
        if (currentVal === '0' || currentVal === '1') {
          directionSelect.value = currentVal;
        }
  }

  /**
   * Handle direction selection
   */
  function onDirectionSelected(direction) {
    if (!selectedVtp) return;

    if (direction === '0') {
      // Sell token0, buy token1
      fromToken = selectedVtp.token0;
      toToken = selectedVtp.token1;
    } else {
      // Sell token1, buy token0
      fromToken = selectedVtp.token1;
      toToken = selectedVtp.token0;
    }

    // Populate parameters
    populateParameters();
  }

  /**
   * Check liquidity and toggle UI state
   */
  function checkLiquidityAndToggleUI() {
    const type = document.getElementById('calc-operation-type').value;
    const btn = document.getElementById('btn-calculate-swap');
    const vtpSelect = document.getElementById('swap-vtp-select');
    
    // Create warning element if not exists
    let warningDiv = document.getElementById('liquidity-warning-div');
    if (!warningDiv) {
        warningDiv = document.createElement('div');
        warningDiv.id = 'liquidity-warning-div';
        warningDiv.style.color = '#ef4444';
        warningDiv.style.marginTop = '8px';
        warningDiv.style.fontSize = '13px';
        warningDiv.style.fontWeight = '500';
        // Insert after Calculate Button
        if (btn && btn.parentNode) {
            btn.parentNode.appendChild(warningDiv);
        }
    }

    if (!selectedVtp) {
        if (btn) btn.disabled = true;
        warningDiv.textContent = '';
        return;
    }

    if (type === 'swap') {
        // Check assets directly from selectedVtp to ensure we have the raw values
        // Note: formatDecimal might have been used for display, but here we check the raw or parsed values
        // selectedVtp.token0.status.assets is likely a BigNumber or string
        const assets0 = parseFloat(COMMON.fromBigNumber ? COMMON.fromBigNumber(selectedVtp.token0?.status?.assets || '0', selectedVtp.token0?.params?.decimals || 18) : (selectedVtp.token0?.status?.assets || '0'));
        const assets1 = parseFloat(COMMON.fromBigNumber ? COMMON.fromBigNumber(selectedVtp.token1?.status?.assets || '0', selectedVtp.token1?.params?.decimals || 18) : (selectedVtp.token1?.status?.assets || '0'));

        if (assets0 > 0 && assets1 > 0) {
            // Both positive - Green
            if (btn) btn.disabled = false;
            warningDiv.textContent = '';
        } else {
            // One or both zero - Red/Warning
            if (btn) btn.disabled = true;
            warningDiv.textContent = '⚠️ Insufficient liquidity for swap (one or both sides are 0). Calculation disabled.';
        }
    } else {
        // Not swap - Reset
        if (btn) btn.disabled = false;
        warningDiv.textContent = '';
    }
  }

  /**
   * Populate parameter inputs with current values
   */
  function populateParameters() {
    if (!selectedVtp || !fromToken || !toToken) return;

    // VTP parameters
    document.getElementById('param-n').value = selectedVtp?.params?.n || '0';
    document.getElementById('param-p').value = formatDecimal(selectedVtp?.params?.p || '0', 2);
    
    const poValRaw = formatDecimal(selectedVtp?.status?.po || '0', 18);
    const paValRaw = formatDecimal(selectedVtp?.status?.pa || '0', 18);
    
    let poVal = poValRaw;
    let paVal = paValRaw;

    // Invert prices if direction is 1->0 (selling token1)
    if (fromToken === selectedVtp.token1) {
        const poNum = parseFloat(poValRaw);
        const paNum = parseFloat(paValRaw);
        
        poVal = (poNum === 0) ? '0' : (1 / poNum).toFixed(18).replace(/\.?0+$/, '');
        paVal = (paNum === 0) ? '0' : (1 / paNum).toFixed(18).replace(/\.?0+$/, '');
    }
    
    document.getElementById('param-po').value = poVal;
    document.getElementById('param-pa').value = paVal;
    
    // Initialize New Po with current Po
    const newPoInput = document.getElementById('param-new-po');
    if (newPoInput) {
        newPoInput.value = poVal;
    }
    
    // Initialize New Pa
    updateNewPa();

    // From token parameters
    const fromDecimals = Number(fromToken?.params?.decimals || 18);
    document.getElementById('param-from-assets').value = formatDecimal(fromToken?.status?.assets || '0', fromDecimals);
    document.getElementById('param-from-liability').value = formatDecimal(fromToken?.status?.liability || '0', fromDecimals);
    document.getElementById('param-from-fee-in').value = formatDecimal(fromToken?.params?.swapFeeIn || '0', 6);
    document.getElementById('param-from-fee-out').value = formatDecimal(fromToken?.params?.swapFeeOut || '0', 6);
    document.getElementById('param-from-protocol-fee').value = formatDecimal(fromToken?.params?.protocolFeeRate || '0', 4);
    document.getElementById('param-from-alr-bound').value = formatDecimal(fromToken?.params?.alrLowerBound || '0', 4);

    // Update total shares for deallocate (using fromToken)
    const totalSharesInput = document.getElementById('param-total-shares');
    if (totalSharesInput) {
        const totalShares = fromToken?.status?.totalShares || '0';
        totalSharesInput.value = formatDecimal(totalShares, 18);
    }

    // To token parameters
    const toDecimals = Number(toToken?.params?.decimals || 18);
    document.getElementById('param-to-assets').value = formatDecimal(toToken?.status?.assets || '0', toDecimals);
    document.getElementById('param-to-liability').value = formatDecimal(toToken?.status?.liability || '0', toDecimals);
    document.getElementById('param-to-fee-in').value = formatDecimal(toToken?.params?.swapFeeIn || '0', 6);
    document.getElementById('param-to-fee-out').value = formatDecimal(toToken?.params?.swapFeeOut || '0', 6);
    document.getElementById('param-to-protocol-fee').value = formatDecimal(toToken?.params?.protocolFeeRate || '0', 4);
    document.getElementById('param-to-alr-bound').value = formatDecimal(toToken?.params?.alrLowerBound || '0', 4);

    // Check liquidity and update UI
    checkLiquidityAndToggleUI();
  }

  /**
   * Update New Pa based on New Po
   * New Pa = Pa * New Po / Po
   */
  function updateNewPa() {
      const po = parseFloat(document.getElementById('param-po').value);
      const pa = parseFloat(document.getElementById('param-pa').value);
      const newPo = parseFloat(document.getElementById('param-new-po').value);
      const newPaInput = document.getElementById('param-new-pa');
      
      if (isNaN(po) || isNaN(pa) || isNaN(newPo) || po === 0) {
          if (newPaInput) newPaInput.value = '0';
          return;
      }
      
      const newPa = pa * newPo / po;
      if (newPaInput) {
          newPaInput.value = newPa.toFixed(18).replace(/\.?0+$/, '');
      }
  }

  /**
   * Format BigNumber to decimal string
   */
  function formatDecimal(value, decimals) {
    if (typeof value === 'object' && value._isBigNumber) {
      return COMMON.fromBigNumber(value, decimals);
    }
    // If value is an integer-like string/number and decimals>0, treat it as base units and scale down
    try {
        const str = String(value ?? '0');
        if (!str.includes('.') && !Number.isNaN(Number(str)) && decimals > 0) {
            const scaled = Number(str) / (10 ** decimals);
            if (Number.isFinite(scaled)) return scaled.toString();
        }
    } catch (e) {}

    return value != null ? value.toString() : '';
  }

  /**
   * Get parameters from UI inputs
   */
  function getParametersFromUI() {
    return {
      vtp: {
        params: {
            n: document.getElementById('param-n').value,
            p: document.getElementById('param-p').value,
        },
        status: {
            po: document.getElementById('param-po').value,
            // Use New Pa for calculation
            pa: document.getElementById('param-new-pa').value
        }
      },
      fromToken: {
        params: {
            decimals: fromToken?.params?.decimals || 18,
            swapFeeIn: document.getElementById('param-from-fee-in').value,
            swapFeeOut: document.getElementById('param-from-fee-out').value,
            protocolFeeRate: document.getElementById('param-from-protocol-fee').value,
            alrLowerBound: document.getElementById('param-from-alr-bound').value
        },
        status: {
            assets: document.getElementById('param-from-assets').value,
            liability: document.getElementById('param-from-liability').value,
        }
      },
      toToken: {
        params: {
            decimals: toToken?.params?.decimals || 18,
            swapFeeIn: document.getElementById('param-to-fee-in').value,
            swapFeeOut: document.getElementById('param-to-fee-out').value,
            protocolFeeRate: document.getElementById('param-to-protocol-fee').value,
            alrLowerBound: document.getElementById('param-to-alr-bound').value
        },
        status: {
            assets: document.getElementById('param-to-assets').value,
            liability: document.getElementById('param-to-liability').value,
        }
      }
    };
  }

  /**
   * Handle Operation Type Change
   */
  function onOperationTypeChanged() {
      const type = document.getElementById('calc-operation-type').value;
      const deallocateParams = document.getElementById('deallocate-params');
      const directionLabel = document.getElementById('direction-label');
      const amountLabel = document.getElementById('amount-label');
      
      // Update labels and visibility
      if (type === 'swap') {
          deallocateParams.style.display = 'none';
          directionLabel.textContent = 'Swap Direction';
          amountLabel.textContent = 'Swap Amount (From Token)';
      } else if (type === 'allocate') {
          deallocateParams.style.display = 'none';
          directionLabel.textContent = 'Token to Allocate';
          amountLabel.textContent = 'Allocate Amount';
      } else if (type === 'deallocate') {
          deallocateParams.style.display = 'block';
          directionLabel.textContent = 'Token to Deallocate';
          amountLabel.textContent = 'Deallocate Amount';
      }
      
      // Update dropdown options
      populateDirectionDropdown();
      
      // Update section headers
      updateSectionHeaders(type);

      // Check liquidity and update UI
      checkLiquidityAndToggleUI();
  }

  function updateSectionHeaders(type) {
      const summaryFrom = document.getElementById('summary-from-token');
      const summaryTo = document.getElementById('summary-to-token');
      
      if (!summaryFrom || !summaryTo) return;
      
      if (type === 'swap') {
          summaryFrom.textContent = 'From Token (Sell)';
          summaryTo.textContent = 'To Token (Buy)';
      } else if (type === 'allocate') {
          summaryFrom.textContent = 'Token to Allocate';
          summaryTo.textContent = 'Paired Token';
      } else if (type === 'deallocate') {
          summaryFrom.textContent = 'Token to Deallocate';
          summaryTo.textContent = 'Paired Token';
      }
  }

  /**
   * Calculate swap and display results
   */
  async function calculateSwap() {
    const type = document.getElementById('calc-operation-type').value;
    const swapAmount = document.getElementById('swap-amount-input').value;
    
    if (!swapAmount || parseFloat(swapAmount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    const params = getParametersFromUI();
    const config = {
      discount: '0',
      excludeSwapFee: false,
      excludePunishment: false,
      paOverwrite: params.vtp.status.pa // Pass the new PA
    };

    console.log('[Calculator] Calculating', type, 'with params:', params);

    let result;
    if (type === 'swap') {
        result = calc.estimateSwapResult(params.vtp, params.fromToken, params.toToken, swapAmount, config);
    } else if (type === 'allocate') {
        // fromToken is the token to allocate
        result = calc.estimateAllocateResult(params.vtp, params.fromToken, params.toToken, swapAmount, config);
        result.type = 'allocate';
    } else if (type === 'deallocate') {
        // fromToken is the token to deallocate
        const userAlloc = document.getElementById('param-user-alloc').value;
        const userShares = document.getElementById('param-user-shares').value;
        const totalShares = document.getElementById('param-total-shares').value;
        result = calc.estimateDeallocateResult(params.vtp, params.fromToken, params.toToken, swapAmount, userAlloc, userShares, totalShares, config);
        result.type = 'deallocate';
    }
    
    console.log('[Calculator] Result:', result);

    if (result.error) {
      alert('Calculation error: ' + result.error);
      return;
    }

    displayResults(result);
  }

  /**
   * Display calculation results
   */
  function displayResults(result) {
    const container = document.getElementById('swap-results-container');
    container.className = 'swap-results-filled';
    
    const formatNumber = (val) => {
      const num = parseFloat(val);
      if (isNaN(num)) return '0';
      return num.toFixed(8);
    };

    const formatPercent = (val) => {
      const num = parseFloat(val) * 100;
      if (isNaN(num)) return '0%';
      return num.toFixed(4) + '%';
    };

    if (result.type === 'allocate') {
        container.innerHTML = `
          <div class="result-section">
            <h4 class="result-section-title">📥 Allocate Result</h4>
            <div class="result-row">
              <span class="result-label">Allocate Fee:</span>
              <span class="result-value highlight-fee">${formatNumber(result.fee)}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Fee Rate:</span>
              <span class="result-value">${formatPercent(result.feeRate)}</span>
            </div>
          </div>
        `;
        return;
    }

    if (result.type === 'deallocate') {
        container.innerHTML = `
          <div class="result-section">
            <h4 class="result-section-title">📤 Deallocate Result</h4>
            <div class="result-row">
              <span class="result-label">Total Amount (Input + Earnings):</span>
              <span class="result-value">${formatNumber(result.totalAmount)}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Earnings:</span>
              <span class="result-value highlight-bonus">${formatNumber(result.earnings)}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Deallocate Fee:</span>
              <span class="result-value highlight-fee">${formatNumber(result.fee)}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Fee Rate:</span>
              <span class="result-value">${formatPercent(result.feeRate)}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Shares to Burn:</span>
              <span class="result-value">${formatNumber(result.burn)}</span>
            </div>
          </div>
        `;
        return;
    }

    container.innerHTML = `
      <div class="result-section result-final">
        <h4 class="result-section-title">✅ Final Result</h4>
        <div class="result-row result-row-large">
          <span class="result-label">Amount Out:</span>
          <span class="result-value ${parseFloat(result.punishment) > 0 ? 'highlight-fee' : (parseFloat(result.punishment) < 0 ? 'highlight-bonus' : 'highlight-output')}">${formatNumber(result.amountOut)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">Slippage:</span>
          <span class="result-value ${parseFloat(result.punishment) > 0 ? 'highlight-fee' : (parseFloat(result.punishment) < 0 ? 'highlight-bonus' : 'highlight-output')}">${formatPercent(result.slippage)}</span>
        </div>
      </div>

      <div class="result-section">
        <h4 class="result-section-title">📥 Input & Initial Fee</h4>
        <div class="result-row">
          <span class="result-label">Amount In:</span>
          <span class="result-value">${formatNumber(result.amountIn)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">Fee by Swap In:</span>
          <span class="result-value highlight-fee">${formatNumber(result.feeBySwapIn)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">Amount After Swap In Fee:</span>
          <span class="result-value">${formatNumber(result.amountAfterSwapInFee)}</span>
        </div>
      </div>

      <div class="result-section">
        <h4 class="result-section-title">🔢 PAV Calculation</h4>
        <div class="result-row">
          <span class="result-label">Pa (used):</span>
          <span class="result-value">${formatNumber(result.pas)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">PAV a:</span>
          <span class="result-value">${formatNumber(result.pavA)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">PAV b:</span>
          <span class="result-value">${formatNumber(result.pavB)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">PAV Delta (a²-4b):</span>
          <span class="result-value">${formatNumber(result.pavDelta)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">PAV t:</span>
          <span class="result-value">${formatNumber(result.pavT)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">PAV (Execution Price):</span>
          <span class="result-value highlight-price">${formatNumber(result.pav)}</span>
        </div>
      </div>

      <div class="result-section">
        <h4 class="result-section-title">💱 Swap Execution</h4>
        <div class="result-row">
          <span class="result-label">Swap Get by PAV:</span>
          <span class="result-value">${formatNumber(result.swapGetByPav)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">Fee by Swap Out:</span>
          <span class="result-value highlight-fee">${formatNumber(result.feeBySwapOut)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">Amount After Swap Out Fee:</span>
          <span class="result-value">${formatNumber(result.amountAfterSwapOutFee)}</span>
        </div>
      </div>

      <div class="result-section">
        <h4 class="result-section-title">⚖️ ALR & Punishment</h4>
        <div class="result-row">
          <span class="result-label">New Ralr (without punishment):</span>
          <span class="result-value">${formatNumber(result.newRalrWithoutPunishment)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">Punishment (negative = bonus):</span>
          <span class="result-value ${parseFloat(result.punishment) > 0 ? 'highlight-fee' : (parseFloat(result.punishment) < 0 ? 'highlight-bonus' : 'highlight-output')}">${formatNumber(result.punishment)}</span>
        </div>
        <div class="result-row">
          <span class="result-label">New Ralr (after punishment):</span>
          <span class="result-value">${formatNumber(result.newRalr)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Reload VTP data while preserving selection
   */
  async function reloadVtps() {
    const reloadBtn = document.getElementById('btn-reload-vtps');
    const originalText = reloadBtn ? reloadBtn.innerText : '↻ Reload Pool Info';
    
    if (reloadBtn) {
        reloadBtn.innerText = 'Loading...';
        reloadBtn.disabled = true;
    }

    try {
        // Store current selection
        const currentVtpId = selectedVtp?.params?.id;
        const directionSelect = document.getElementById('swap-direction');
        const currentDirection = directionSelect ? directionSelect.value : '0';

        // Reload data and repopulate dropdown
        await populateVtpDropdown();

        // Restore selection if possible
        if (currentVtpId !== undefined && currentVtpId !== null) {
            const select = document.getElementById('swap-vtp-select');
            // Find index of vtp with this id
            const newIndex = allVtps.findIndex(v => v.params.id === currentVtpId);
            
            if (newIndex >= 0) {
                select.value = newIndex;
                // Trigger selection logic
                onVtpSelected(newIndex);
                
                // Restore direction
                if (directionSelect) {
                    directionSelect.value = currentDirection;
                    onDirectionSelected(currentDirection);
                }
            }
        }
    } catch (e) {
        console.error('Failed to reload VTPs:', e);
    } finally {
        if (reloadBtn) {
            reloadBtn.innerText = originalText;
            reloadBtn.disabled = false;
        }
    }
  }

  /**
   * Initialize UI
   */
  async function init() {
    console.log('[Swap Calculator UI] Initializing...');

    // Populate VTP dropdown
    await populateVtpDropdown();

    // Event listeners
    const vtpSelect = document.getElementById('swap-vtp-select');
    if (vtpSelect) {
      vtpSelect.addEventListener('change', (e) => {
        onVtpSelected(e.target.value);
      });
    }

    const directionSelect = document.getElementById('swap-direction');
    if (directionSelect) {
      directionSelect.addEventListener('change', (e) => {
        onDirectionSelected(e.target.value);
      });
    }

    const calculateBtn = document.getElementById('btn-calculate-swap');
    if (calculateBtn) {
      calculateBtn.addEventListener('click', calculateSwap);
    }

    const newPoInput = document.getElementById('param-new-po');
    if (newPoInput) {
        newPoInput.addEventListener('input', updateNewPa);
    }

    const reloadBtn = document.getElementById('btn-reload-vtps');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', reloadVtps);
    }

    const opTypeSelect = document.getElementById('calc-operation-type');
    if (opTypeSelect) {
        opTypeSelect.addEventListener('change', onOperationTypeChanged);
    }

    console.log('[Swap Calculator UI] Initialization complete');
  }

  // Start initialization when tab is active
  const observer = new MutationObserver(() => {
    const swapTab = document.getElementById('tab-swap');
    if (swapTab && swapTab.classList.contains('active') && allVtps.length === 0) {
      init();
    }
  });

  const swapTab = document.getElementById('tab-swap');
  if (swapTab) {
    observer.observe(swapTab, { attributes: true, attributeFilter: ['class'] });
  }

  // Also init immediately if tab is already active
  if (swapTab && swapTab.classList.contains('active')) {
    init();
  }

})();
