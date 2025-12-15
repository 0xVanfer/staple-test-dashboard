/**
 * Swap Calculator - Offline swap simulation without contract interaction.
 * Translates swap calculation logic from Go/Solidity to JavaScript.
 * Handles Swap, Allocate, and Deallocate estimations.
 */
// Dependencies: src/lib/common.js
(function() {
  'use strict';

  const WAD = 10n ** 18n;

  /**
   * BigInt Math Utilities
   */
  const BigIntMath = {
    /**
     * Performs multiplication and division: (a * b) / c
     * @param {bigint} a - Multiplier
     * @param {bigint} b - Multiplicand
     * @param {bigint} c - Divisor
     * @param {string} rounding - 'floor' or 'ceil'
     * @returns {bigint} Result
     */
    mulDiv: (a, b, c, rounding = 'floor') => {
      const product = a * b;
      if (rounding === 'ceil') {
        return (product + c - 1n) / c;
      }
      return product / c;
    },
    /**
     * Calculates integer square root.
     * @param {bigint} value - Input value
     * @returns {bigint} Square root
     */
    sqrt: (value) => {
      if (value < 0n) {
        throw new Error('negative sqrt');
      }
      if (value < 2n) {
        return value;
      }
      let x0 = value;
      let x1 = (x0 + value / x0) >> 1n;
      while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + value / x0) >> 1n;
      }
      return x0;
    },
    abs: (n) => (n < 0n ? -n : n),
    max: (a, b) => (a > b ? a : b),
    min: (a, b) => (a < b ? a : b)
  };

  /**
   * Parses a string value to BigInt with specified decimals.
   * @param {string|number} value - The value to parse.
   * @param {number} decimals - Number of decimals.
   * @returns {bigint} The parsed BigInt.
   */
  function parseUnits(value, decimals) {
    if (!value) return 0n;
    if (typeof value !== 'string') value = value.toString();
    let [integer, fraction = ''] = value.split('.');
    if (fraction.length > decimals) {
      fraction = fraction.slice(0, decimals);
    }
    fraction = fraction.padEnd(decimals, '0');
    return BigInt(integer + fraction);
  }

  /**
   * Safely parse a human-readable numeric string into a BigInt with given decimals.
   * Falls back to 0n on invalid input to avoid throwing in the UI.
   * @param {string|number} value - Human readable value (may include decimals).
   * @param {number} decimals - Decimal places to scale by.
   * @returns {bigint}
   */
  function parseInputToBigInt(value, decimals) {
    try {
      return parseUnits(String(value ?? '0'), decimals);
    } catch (e) {
      console.warn('[swapCalculator] Failed to parse value to BigInt', { value, decimals, e });
      return 0n;
    }
  }

  /**
   * Formats a BigInt to a string with specified decimals.
   * @param {bigint} value - The BigInt value.
   * @param {number} decimals - Number of decimals.
   * @returns {string} The formatted string.
   */
  function formatUnits(value, decimals) {
    let negative = false;
    if (value < 0n) {
      negative = true;
      value = -value;
    }
    const s = value.toString().padStart(decimals + 1, '0');
    const integer = s.slice(0, -decimals);
    const fraction = s.slice(-decimals);
    let result = `${integer}.${fraction}`.replace(/\.?0+$/, '');
    if (result === '') result = '0';
    return negative ? '-' + result : result;
  }

  /**
   * Scales an amount up to 18 decimals (WAD).
   * @param {bigint} amount - The amount to scale.
   * @param {number} decimals - The current decimals of the amount.
   * @returns {bigint} The scaled amount.
   */
  function upToWad(amount, decimals) {
    if (decimals === 18) return amount;
    if (decimals < 18) return amount * (10n ** BigInt(18 - decimals));
    return amount / (10n ** BigInt(decimals - 18));
  }

  /**
   * Calculates the estimated result of a swap.
   * @param {Object} vtp - VTP configuration and status.
   * @param {Object} fromToken - Source token data.
   * @param {Object} toToken - Destination token data.
   * @param {string} swapAmount - Amount to swap.
   * @param {Object} config - Optional configuration overrides.
   * @returns {Object} Swap result details.
   */
  function estimateSwapResult(vtp, fromToken, toToken, swapAmount, config) {
    try {
      const decimalsIn = Number(fromToken.params?.decimals || 18);
      const decimalsOut = Number(toToken.params?.decimals || 18);

      // Inputs are strings from UI (human readable)
      const amountIn = parseUnits(swapAmount, decimalsIn);
      if (amountIn === 0n) {
        return { error: 'Zero amount' };
      }

      // Parse Token Params
      const assetsIn = parseUnits(fromToken.status.assets, decimalsIn);
      const liabilityIn = parseUnits(fromToken.status.liability, decimalsIn);
      const assetsOut = parseUnits(toToken.status.assets, decimalsOut);
      const liabilityOut = parseUnits(toToken.status.liability, decimalsOut);

      // Fee rates and bounds are contract integers
      const swapFeeIn = parseInputToBigInt(fromToken.params.swapFeeIn, 6);
      const swapFeeOut = parseInputToBigInt(toToken.params.swapFeeOut, 6);
      const protocolFeeRate = parseInputToBigInt(toToken.params.protocolFeeRate, 4);
      const alrLowerBound = parseInputToBigInt(toToken.params.alrLowerBound, 4);

      // VTP Params
      const n = parseInputToBigInt(vtp.params.n, 0);
      const p = parseInputToBigInt(vtp.params.p, 18);

      // pa is human readable (e.g. "1.0")
      let pa = parseInputToBigInt(vtp.status.pa, 18);

      // Handle PA overwrite from config
      if (config && config.paOverwrite) {
        pa = parseInputToBigInt(config.paOverwrite, 18);
      }

      // Discount
      let discount = 0n;
      if (config) {
        if (config.excludeSwapFee) {
          discount = WAD; // 100% discount
        } else if (config.discount) {
          discount = parseInputToBigInt(config.discount, 18);
        }
      }
      const rateAfterDiscount = WAD - discount;

      // 1. Fee In
      let feeIn = BigIntMath.mulDiv(amountIn, swapFeeIn, 1000000n, 'ceil');
      let realFeeIn = discount > 0n ? BigIntMath.mulDiv(feeIn, rateAfterDiscount, WAD) : feeIn;
      let realIn = amountIn - realFeeIn;

      // 2. Swap (PAV)
      const realInWad = upToWad(realIn, decimalsIn);
      const a0Wad = upToWad(assetsIn, decimalsIn);
      const a1Wad = upToWad(assetsOut, decimalsOut);

      const { pav, pavA, pavB, pavDelta, pavT } = _calcPav(n, pa, a0Wad, a1Wad, realInWad);

      const divisor = 10n ** BigInt(36 - decimalsOut);
      const swapGet = (realInWad * pav) / divisor;
      console.log('swapGet:', swapGet.toString());
      console.log('swapFeeOut:', swapFeeOut.toString());

      // 3. Fee Out
      let feeOut = BigIntMath.mulDiv(swapGet, swapFeeOut, 1000000n, 'ceil');
      console.log('feeOut:', feeOut.toString());
      let realFeeOut = discount > 0n ? BigIntMath.mulDiv(feeOut, rateAfterDiscount, WAD) : feeOut;
      console.log('realFeeOut:', realFeeOut.toString());
      let estiOut = swapGet - realFeeOut;

      // 4. Punishments / Rewards
      const newAlrIn = BigIntMath.mulDiv(assetsIn + amountIn, WAD, liabilityIn + realFeeIn, 'ceil');
      const newAlrOut = BigIntMath.mulDiv(assetsOut - estiOut, WAD, liabilityOut + realFeeOut, 'floor');
      const newRalr = BigIntMath.mulDiv(newAlrIn, WAD, newAlrOut, 'ceil');

      const { isPunishment, punishment } = _calcExtraPunishment(p, newRalr, estiOut);

      let realOut;
      if (isPunishment) {
        realOut = estiOut - punishment;
      } else {
        realOut = estiOut + punishment;
      }

      // 5. Restriction Check (AlrTooLowAfterSwap)
      const lpsFee = BigIntMath.mulDiv(realFeeOut, 10000n - protocolFeeRate, 10000n, 'floor');
      const newAssetOut = assetsOut - realOut;
      const newLiabilityOut = liabilityOut + lpsFee;

      if (newAssetOut * 10000n <= alrLowerBound * newLiabilityOut) {
        // In simulation we might just return error or flag
        // return { error: 'AlrTooLowAfterSwap' };
      }

      // Slippage
      const realOutWad = upToWad(realOut, decimalsOut);
      const amountInWad = upToWad(amountIn, decimalsIn);
      const expectedOutWad = (amountInWad * pa) / WAD;

      let slippage = 0n;
      if (expectedOutWad > 0n) {
        slippage = WAD - (realOutWad * WAD) / expectedOutWad;
      }

      let signedPunishment = punishment;
      if (!isPunishment) {
        signedPunishment = -punishment;
      }

      // Format Results
      return {
        amountIn: formatUnits(amountIn, decimalsIn),
        feeBySwapIn: formatUnits(realFeeIn, decimalsIn),
        amountAfterSwapInFee: formatUnits(realIn, decimalsIn),
        pas: formatUnits(pa, 18),
        pav: formatUnits(pav, 18),
        pavA: formatUnits(pavA, 18),
        pavB: formatUnits(pavB, 18),
        pavDelta: formatUnits(pavDelta, 36), // delta is squared, so 36 decimals
        pavT: formatUnits(pavT, 18),
        swapGetByPav: formatUnits(swapGet, decimalsOut),
        feeBySwapOut: formatUnits(realFeeOut, decimalsOut),
        amountAfterSwapOutFee: formatUnits(estiOut, decimalsOut),
        newRalrWithoutPunishment: formatUnits(newRalr, 18),
        punishment: formatUnits(signedPunishment, decimalsOut),
        amountOut: formatUnits(realOut, decimalsOut),
        newRalr: formatUnits(newRalr, 18),
        slippage: formatUnits(slippage, 18)
      };

    } catch (e) {
      console.error(e);
      return { error: e.message };
    }
  }

  /**
   * Calculates the estimated fee for allocating assets.
   * @param {Object} vtp - VTP configuration.
   * @param {Object} token - Token being allocated.
   * @param {Object} pairedToken - The paired token in the VTP.
   * @param {string} amount - Amount to allocate.
   * @param {Object} config - Optional configuration.
   * @returns {Object} Fee details.
   */
  function estimateAllocateResult(vtp, token, pairedToken, amount, config) {
    try {
      const decimals = Number(token.params?.decimals || 18);
      const decimalsPaired = Number(pairedToken.params?.decimals || 18);
      const amountIn = parseUnits(amount, decimals);
      if (amountIn === 0n) return { fee: '0', feeRate: '0' };

      // Token Status
      const assets = parseUnits(token.status.assets, decimals);
      const liability = parseUnits(token.status.liability, decimals);
      const assetsPaired = parseUnits(pairedToken.status.assets, decimalsPaired);
      const liabilityPaired = parseUnits(pairedToken.status.liability, decimalsPaired);

      // Params
      const alrLowerBound = parseInputToBigInt(token.params.alrLowerBound, 4);
      const alrLowerBoundPaired = parseInputToBigInt(pairedToken.params.alrLowerBound, 4);
      const n = parseInputToBigInt(vtp.params.n, 0);

      // Pa
      let pa = parseInputToBigInt(vtp.status.pa, 18);
      if (config && config.paOverwrite) {
        pa = parseInputToBigInt(config.paOverwrite, 18);
      }

      // Check ALR 1e18 condition (simplified check)
      if (assets === liability && assetsPaired === liabilityPaired) {
        return { fee: '0', feeRate: '0' };
      }

      let fee = 0n;

      const a0Wad = upToWad(assets, decimals);
      const l0Wad = upToWad(liability, decimals);
      const amountWad = upToWad(amountIn, decimals);

      // WP 3.3. aer <= 1/n * y1 * (a0 - l0) / l0 / (a0 + D) / Pa0'
      if (a0Wad >= l0Wad && (assetsPaired * 10000n > liabilityPaired * alrLowerBoundPaired)) {
        const y1 = upToWad((assetsPaired * 10000n - liabilityPaired * alrLowerBoundPaired) / 10000n, decimalsPaired);

        // x = y1 * (y1 * pa + (a0 - l0)) / (y1 * pa + (a0 + amount))
        const num = y1 * pa + (a0Wad - l0Wad) * WAD;
        const den = y1 * pa + (a0Wad + amountWad) * WAD;
        const x = BigIntMath.mulDiv(y1, num, den, 'ceil');

        // fee = amount * x / (l0 * pa * n)
        fee = BigIntMath.mulDiv(amountIn, x * WAD, l0Wad * pa * n, 'ceil');
      }

      // WP 3.2. aer <= 1/n * y0 * (l0 - a0) / a0 / (l0 + D)
      if (l0Wad >= a0Wad) {
        const num1 = a0Wad * 10000n - l0Wad * alrLowerBound;
        const num2 = l0Wad * (10000n - alrLowerBound);
        const num = num1 * num2;

        const den1 = l0Wad * alrLowerBound;
        const den2 = (l0Wad + amountWad) * 10000n * n;
        const den = den1 * den2;

        const newFee = BigIntMath.mulDiv(amountIn, num, den, 'ceil');

        if (newFee > fee) fee = newFee;
      }

      const feeRate = amountIn > 0n ? BigIntMath.mulDiv(fee, WAD, amountIn) : 0n;

      return {
        fee: formatUnits(fee, decimals),
        feeRate: formatUnits(feeRate, 18)
      };

    } catch (e) {
      console.error(e);
      return { error: e.message };
    }
  }

  /**
   * Calculates the estimated result of deallocating assets.
   * @param {Object} vtp - VTP configuration.
   * @param {Object} token - Token being deallocated.
   * @param {Object} pairedToken - The paired token.
   * @param {string} amount - Amount to deallocate.
   * @param {string} userAllocation - Current user allocation.
   * @param {string} userShares - Current user shares.
   * @param {string} totalShares - Total shares.
   * @param {Object} config - Optional configuration.
   * @returns {Object} Deallocation result details.
   */
  function estimateDeallocateResult(vtp, token, pairedToken, amount, userAllocation, userShares, totalShares, config) {
    try {
      const decimals = Number(token.params?.decimals || 18);
      const decimalsPaired = Number(pairedToken.params?.decimals || 18);
      const amountIn = parseUnits(amount, decimals);
      const userAlloc = parseUnits(userAllocation, decimals);
      const sharesDecimals = 18;
      const uSharesBig = parseUnits(userShares, sharesDecimals);
      const tSharesBig = parseUnits(totalShares, sharesDecimals);

      if (amountIn === 0n) return { fee: '0', earnings: '0', burn: '0' };

      // Token Status
      const assets = parseUnits(token.status.assets, decimals);
      const liability = parseUnits(token.status.liability, decimals);
      const assetsPaired = parseUnits(pairedToken.status.assets, decimalsPaired);
      const liabilityPaired = parseUnits(pairedToken.status.liability, decimalsPaired);
      const alrLowerBound = parseInputToBigInt(token.params.alrLowerBound, 4);
      const alrLowerBoundPaired = parseInputToBigInt(pairedToken.params.alrLowerBound, 4);
      const n = parseInputToBigInt(vtp.params.n, 0);

      let pa = parseInputToBigInt(vtp.status.pa, 18);
      if (config && config.paOverwrite) {
        pa = parseInputToBigInt(config.paOverwrite, 18);
      }

      // Initial check
      if (assets === liability && assetsPaired === liabilityPaired) {
        return {
          fee: '0',
          earnings: '0',
          burn: formatUnits(amountIn, sharesDecimals),
          amount: formatUnits(amountIn, decimals)
        };
      }

      // Calculate profit and shares to burn
      const sharePrice = tSharesBig > 0n ? BigIntMath.mulDiv(liability, WAD, tSharesBig) : WAD;
      const userSharesValue = BigIntMath.mulDiv(sharePrice, uSharesBig, WAD);

      const remainingAlloc = userAlloc > amountIn ? userAlloc - amountIn : 0n;
      const sharesToKeep = BigIntMath.mulDiv(remainingAlloc, WAD, sharePrice);
      const sharesToBurn = uSharesBig > sharesToKeep ? uSharesBig - sharesToKeep : 0n;

      const earnings = userSharesValue > userAlloc ? userSharesValue - userAlloc : 0n;
      const totalAmount = amountIn + earnings;

      if (totalAmount === 0n) return { fee: '0', earnings: formatUnits(earnings, decimals), burn: formatUnits(sharesToBurn, sharesDecimals) };

      // Normal Part / Pause Part
      let normalPart = totalAmount;
      let pausePart = 0n;

      const newAsset = assets > totalAmount ? assets - totalAmount : 0n;
      const newLiability = liability > totalAmount ? liability - totalAmount : 0n;

      if (newLiability > 0n) {
        const newAlr = BigIntMath.mulDiv(newAsset, WAD, newLiability);
        const c = upToWad(alrLowerBound, 4);

        if (newAlr < c) {
          const num = assets * WAD - liability * c;
          const den = WAD - c;
          normalPart = num / den;
          pausePart = totalAmount > normalPart ? totalAmount - normalPart : 0n;
        }
      }

      let fee = 0n;
      const a0Wad = upToWad(assets, decimals);
      const l0Wad = upToWad(liability, decimals);
      const normalPartWad = upToWad(normalPart, decimals);

      // WP 3.4
      if (l0Wad >= a0Wad) {
        const a1Wad = upToWad(assetsPaired, decimalsPaired);
        const l1Wad = upToWad(liabilityPaired, decimalsPaired);

        const term1 = a1Wad * 10000n - l1Wad * alrLowerBoundPaired;
        const term2 = l0Wad - a0Wad;
        const num = normalPart * term1 * term2;

        const den = l0Wad * (a0Wad - normalPartWad) * 10000n;

        if (den > 0n) {
          const x = BigIntMath.mulDiv(num, 1n, den, 'ceil');
          fee = BigIntMath.mulDiv(x, WAD, pa * n, 'ceil');
        }
      }

      // WP 3.1
      if (a0Wad >= l0Wad) {
        const term1 = a0Wad * 10000n - l0Wad * alrLowerBound;
        const term2 = a0Wad - l0Wad;
        const num = normalPart * term1 * term2;

        const den = a0Wad * (l0Wad - normalPartWad) * 10000n * n;

        if (den > 0n) {
          const newFee = BigIntMath.mulDiv(num, 1n, den, 'ceil');
          if (newFee > fee) fee = newFee;
        }
      }

      // Pause Part Fee
      if (pausePart > 0n) {
        const pFee = BigIntMath.mulDiv(pausePart, 10000n - alrLowerBound, 10000n);
        fee += pFee;
      }

      const feeRate = totalAmount > 0n ? BigIntMath.mulDiv(fee, WAD, totalAmount) : 0n;

      return {
        fee: formatUnits(fee, decimals),
        feeRate: formatUnits(feeRate, 18),
        earnings: formatUnits(earnings, decimals),
        burn: formatUnits(sharesToBurn, sharesDecimals),
        totalAmount: formatUnits(totalAmount, decimals)
      };

    } catch (e) {
      console.error(e);
      return { error: e.message };
    }
  }

  /**
   * Internal helper to calculate PAV (Price Adjusted Value).
   */
  function _calcPav(n, pas, assetInWad, assetOutWad, realInWad) {
    // _2nC2 = n * (2 * n - 1)
    const _2nC2 = n * (2n * n - 1n);

    // a_ = (realInWad * pas / assetOutWad * assetInWad / (assetInWad + realInWad) + 2 * n * 1e18) / _2nC2
    const term1 = BigIntMath.mulDiv(realInWad, pas, assetOutWad);
    const term2 = BigIntMath.mulDiv(term1, assetInWad, assetInWad + realInWad);

    const a = (term2 + 2n * n * WAD) / _2nC2;

    // b_ = ...
    const num1 = assetInWad * pas + assetOutWad * WAD;
    const den1 = assetInWad * assetOutWad;
    const termB1 = BigIntMath.mulDiv(realInWad, num1, den1, 'ceil');

    const termB2 = BigIntMath.mulDiv(termB1, assetInWad, assetInWad + realInWad, 'ceil');

    const b = (termB2 + _2nC2 - 1n) / _2nC2;

    // delta = a^2 - 4 * 1e18 * b
    const delta = a * a - 4n * WAD * b;
    if (delta < 0n) throw new Error('InvalidSwapDelta');

    // t = (a - sqrt(delta)) / 2
    const t = (a - BigIntMath.sqrt(delta)) / 2n;

    // pav = (1e18 - t) * pas / 1e18
    return {
      pav: BigIntMath.mulDiv(WAD - t, pas, WAD),
      pavA: a,
      pavB: b,
      pavDelta: delta,
      pavT: t
    };
  }

  /**
   * Internal helper to calculate extra punishment/reward based on RALR.
   */
  function _calcExtraPunishment(p, newRalr, estiOut) {
    // m = p.upToWad(4) + 1e18
    const m = p * (10n ** 14n) + WAD;

    if (newRalr > m) {
      // subSquares = newRalr^2 - m^2
      const subSquares = newRalr * newRalr - m * m;
      // punishAmount = estiOut * subSquares / (subSquares + newRalr * m) (Ceil)
      const den = subSquares + newRalr * m;
      let punishAmount = BigIntMath.mulDiv(estiOut, subSquares, den, 'ceil');
      if (punishAmount > estiOut) punishAmount = estiOut;
      return { isPunishment: true, punishment: punishAmount };
    } else if (newRalr * m < WAD * WAD) { // 1e36
      // ralrMulM = newRalr * m / 1e18 (Ceil)
      const ralrMulM = BigIntMath.mulDiv(newRalr, m, WAD, 'ceil');
      // punishAmount = estiOut * (1e36 - ralrMulM^2) / (1e36 + ralrMulM * (1e18 - ralrMulM))
      const sq = ralrMulM * ralrMulM;
      const num = (WAD * WAD) - sq;
      const den = (WAD * WAD) + ralrMulM * (WAD - ralrMulM);
      const punishAmount = BigIntMath.mulDiv(estiOut, num, den, 'floor');
      return { isPunishment: false, punishment: punishAmount };
    }
    return { isPunishment: false, punishment: 0n };
  }

  function estimateSafeSwapAmount() {
    return { amount: '0', slippage: '0' };
  }

  // Export functions to window
  window.swapCalculator = {
    estimateSwapResult,
    estimateAllocateResult,
    estimateDeallocateResult,
    estimateSafeSwapAmount,
    DecimalMath: {
      // Minimal mock for compatibility if needed
      add: (a, b) => formatUnits(parseUnits(a, 18) + parseUnits(b, 18), 18),
      sub: (a, b) => formatUnits(parseUnits(a, 18) - parseUnits(b, 18), 18),
      mul: (a, b) => formatUnits(BigIntMath.mulDiv(parseUnits(a, 18), parseUnits(b, 18), WAD), 18),
      div: (a, b) => formatUnits(BigIntMath.mulDiv(parseUnits(a, 18), WAD, parseUnits(b, 18)), 18),
      isZero: (a) => parseUnits(a, 18) === 0n,
      gt: (a, b) => parseUnits(a, 18) > parseUnits(b, 18),
      lt: (a, b) => parseUnits(a, 18) < parseUnits(b, 18),
    }
  };

})();
