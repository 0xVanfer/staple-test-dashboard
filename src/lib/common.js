(function () {
  // Dependencies: ethers.js
  if (window.stapleCommon) return; // Prevent duplicate injection

  // =========================
  // Blockscan Links
  // =========================
  const BlockscanLinks = {
    1: "https://etherscan.io/",
    10: "https://optimistic.etherscan.io/",
    56: "https://bscscan.com/",
    66: "https://www.oklink.com/",
    100: "https://gnosisscan.io/",
    137: "https://polygonscan.com/",
    146: "https://sonicscan.org/",
    239: "https://explorer.tac.build/",
    250: "https://ftmscan.com/",
    252: "https://fraxscan.com/",
    314: "https://filscan.io/",
    324: "https://explorer.zksync.io/",
    1101: "https://zkevm.polygonscan.com/",
    1284: "https://moonscan.io/",
    1329: "https://seitrace.com/",
    2031: "https://centrifuge.subscan.io/",
    2222: "https://kavascan.com/",
    4200: "https://scan.merlinchain.io/",
    5000: "https://mantlescan.xyz/",
    8453: "https://basescan.org/",
    9745: "https://plasmascan.to/",
    10143: "https://testnet.monadexplorer.com/",
    13371: "https://immutascan.io/",
    34443: "https://explorer.mode.network/",
    42161: "https://arbiscan.io/",
    42220: "https://celoscan.io/",
    43114: "https://snowscan.xyz/",
    48900: "https://explorer.zircuit.com/",
    59144: "https://lineascan.build/",
    80094: "https://berascan.com/",
    81457: "https://blastscan.io/",
    167000: "https://taikoscan.io/",
    421614: "https://sepolia.arbiscan.io/",
    534352: "https://scrollscan.com/",
    810180: "https://explorer.zklink.io/",
    11155111: "https://sepolia.etherscan.io/",
  };

  function getExplorerLink(chainId, address) {
    if (!chainId || !BlockscanLinks[chainId]) return null;
    const baseUrl = BlockscanLinks[chainId];
    // Handle different explorer URL patterns if necessary, but most support /address/0x...
    // Some might be /account/ or /token/ but /address/ is standard for Etherscan clones.
    // For non-etherscan, we might need to check, but let's assume /address/ works or is redirected.
    // OKLink uses /address/
    // Filscan uses /address/
    // ZkSync uses /address/
    return `${baseUrl.replace(/\/$/, '')}/address/${address}`;
  }

  // =========================
  // STAPLE_CORE_UTILS Basic Utilities
  // =========================
  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function pLimit(concurrency = 6) {
    const queue = [];
    let active = 0;
    const next = () => {
      if (active >= concurrency || queue.length === 0) return;
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve)
        .catch(reject)
        .finally(() => { active--; next(); });
    };
    return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
  }

  function isValidUrl(maybe) {
    try { new URL(maybe); return true; } catch { return false; }
  }

  function isAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    const basic = /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
    if (!basic) return false;
    if (window.ethers?.utils?.isAddress) {
      try { window.ethers.utils.isAddress(addr); return true; } catch { return true; }
    }
    return basic;
  }

  function normalizeAddress(addr) {
    if (!isAddress(addr)) return '';
    try {
      if (window.ethers?.utils?.getAddress) return window.ethers.utils.getAddress(addr);
    } catch {}
    return addr;
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(text) {
    const el = document.createElement('div');
    el.className = 'env-toast';
    el.textContent = text || 'Success';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, 1600);
  }

  function setupCopyDelegation(selector = '.copy-btn', attr = 'data-copy-target') {
    if (document.__stapleCopyBound) return;
    document.__stapleCopyBound = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest(selector);
      if (!btn) return;
      const id = btn.getAttribute(attr);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      const text = (el.textContent || '').trim();
      if (!text) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        showToast('Copied successfully');
      } catch {
        alert('Copy failed');
      }
    });
  }

  // =========== RPC Provider Access ===========
  function getRpcProvider() {
    if (window.RpcManager && window.RpcManager.getProvider()) {
      return window.RpcManager.getProvider();
    }
    // Fallback if RpcManager is not initialized yet (should not happen if flow is correct)
    const r = window.environment?.getAllParams().rpc;
    if (!r) throw new Error('RPC not set');
    return new ethers.providers.JsonRpcProvider(r);
  }

  // =========== Signer Check ===========
  function isSigner(obj) {
    return obj && typeof obj === 'object' && typeof obj.getAddress === 'function';
  }

  // =========== Resolve Signer Logic ===========
  async function resolveSigner(signerOrAddr) {
    if (isSigner(signerOrAddr)) return signerOrAddr;
    
    let addr = typeof signerOrAddr === 'string' ? signerOrAddr : '';
    
    // If address is not valid, try to get from contractDeployer
    if (!isAddress(addr)) {
      const dep = window.environment?.getAllParams().contractDeployer;
      if (isAddress(dep)) addr = dep;
    }

    if (!isAddress(addr)) return null;
    
    // Reject Zero Address for signing
    if (window.ethers && window.ethers.constants && addr === window.ethers.constants.AddressZero) return null;
    if (addr === "0x0000000000000000000000000000000000000000") return null;

    const provider = getRpcProvider();
    const env = window.environment;
    
    // If environment is not available, fallback to simple impersonation (legacy behavior)
    if (!env) {
        try { return provider.getSigner(addr); } catch { return null; }
    }

    const isProduction = env.getAllParams().isProduction;
    const userList = env.getUserList ? env.getUserList() : [];
    const userEntry = userList.find(u => u.address.toLowerCase() === addr.toLowerCase());
    
    // Check for Deployer Private Key if address matches contractDeployer
    const deployerAddr = env.getAllParams().contractDeployer;
    const deployerPk = env.getAllParams().deployerPrivateKey;
    
    let privateKey = userEntry?.privateKey;
    
    if (deployerAddr && addr.toLowerCase() === deployerAddr.toLowerCase() && deployerPk) {
        privateKey = deployerPk;
    }

    // If we have a private key, use it (works for both Prod and Local)
    if (privateKey) {
        try {
            if (window.ethers && window.ethers.Wallet) {
                return new window.ethers.Wallet(privateKey, provider);
            }
        } catch (e) {
            console.error("Invalid Private Key for user", addr, e);
        }
    }

    if (isProduction) {
        // Production: No impersonation allowed.
        // If we are here, we have no private key.
        console.warn(`[Production] No private key for ${addr}. Operations will fail.`);
        return null; 
    } else {
        // Local/Test: Allow impersonation
        try {
            // Try to impersonate via hardhat_impersonateAccount if possible
            try {
                await provider.send("hardhat_impersonateAccount", [addr]);
            } catch (e) {
                try {
                    await provider.send("anvil_impersonateAccount", [addr]);
                } catch (e2) {
                    // Ignore if not supported (e.g. real testnet)
                }
            }
            return provider.getSigner(addr);
        } catch (e) {
            console.warn('Failed to get signer from provider:', e);
        }
    }
    
    return null;
  }

  // =========================
  // STAPLE_UTIL_FORMAT Number/BigNumber Formatting
  // =========================

  /**
   * Format number
   * STAPLE_PREFERRED_API
   * @param {number|string} value Number or parsable string
   * @param {number|string} digits Decimal places (truncation only); default 6
   * @returns {string} Formatted string
   */
  function formatNumber(value, digits = 6) {
    try {
      if (value === null || value === undefined || value === '') {
        return fixedZeroDigits(digits);
      }
      const d = parseInt(digits, 10);
      const safeDigits = isFinite(d) && d >= 0 ? d : 6;
      let s = typeof value === 'number' && !Number.isNaN(value)
        ? String(value)
        : (typeof value === 'string' ? value.trim() : '');

      if (!s) return fixedZeroDigits(safeDigits);

      // Handle scientific notation
      if (/e/i.test(s)) {
        const n = Number(s);
        if (!isFinite(n)) return fixedZeroDigits(safeDigits);
        s = n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
      }

      // Remove non-numeric characters (keep one negative sign and one decimal point)
      const neg = s.startsWith('-');
      s = s.replace(/[^0-9.]/g, '');
      const parts = s.split('.');

      let intPart = parts[0] || '0';
      let decPart = (parts[1] || '').replace(/\./g, '');

      // Truncate
      decPart = decPart.slice(0, safeDigits);
      // Pad with zeros
      while (decPart.length < safeDigits) decPart += '0';

      return `${neg && intPart !== '0' ? '-' : ''}${intPart}.${decPart}`;
    } catch {
      const d = parseInt(digits, 10);
      return fixedZeroDigits(isFinite(d) && d >= 0 ? d : 6);
    }
  }

  function fixedZeroDigits(d) {
    const dd = isFinite(d) && d >= 0 ? d : 6;
    return `0.${'0'.repeat(dd)}`;
  }

  /**
   * Convert BigNumber / string (integer representation) to JS number (potential precision loss)
   * STAPLE_PREFERRED_API
   * @param {import('ethers')?.BigNumber|string|number} value BigNumber or decimal string / number
   * @param {number|string} decimals Decimals (can be string)
   * @returns {number} JS Number
   */
  function fromBigNumber(value, decimals = 18) {
    try {
      const d = parseInt(decimals, 10);
      const safeDecimals = isFinite(d) && d >= 0 ? d : 18;

      const normalizeVal = (v) => {
        if (v === undefined || v === null) return '0';
        if (typeof v === 'string' && v.startsWith('0x') && window.ethers?.BigNumber) {
          try {
            return window.ethers.BigNumber.from(v);
          } catch (_err) {
            return v;
          }
        }
        return v;
      };

      const v = normalizeVal(value);

      if (window.ethers?.utils?.formatUnits) {
        try {
          return Number(window.ethers.utils.formatUnits(v, safeDecimals));
        } catch (_err) {
          // fall through to legacy paths
        }
      }

      if (window.ethers?.BigNumber?.isBigNumber?.(v)) {
        const s = window.ethers.utils.formatUnits(v, safeDecimals);
        return Number(s);
      }

      if (typeof v === 'string' && /^\d+$/.test(v)) {
        if (window.ethers?.utils?.formatUnits) {
          return Number(window.ethers.utils.formatUnits(v, safeDecimals));
        }
        if (v.length <= safeDecimals) {
          const pad = v.padStart(safeDecimals + 1, '0');
          return Number(`${pad.slice(0, pad.length - safeDecimals)}.${pad.slice(-safeDecimals)}`);
        }
        const int = v.slice(0, v.length - safeDecimals);
        const dec = v.slice(v.length - safeDecimals);
        return Number(`${int}.${dec}`);
      }

      return Number(v) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Convert number to BigNumber (or raw decimal string)
   * STAPLE_PREFERRED_API
   * @param {number|string} value Input number
   * @param {number|string} decimals Decimals
   * @returns {import('ethers')?.BigNumber|string} BigNumber or raw string (no decimal point)
   */
  function toBigNumber(value, decimals = 18) {
    const d = parseInt(decimals, 10);
    const safeDecimals = isFinite(d) && d >= 0 ? d : 18;
    const raw = (typeof value === 'number')
      ? (Number.isFinite(value) ? value.toString() : '0')
      : (typeof value === 'string' ? value.trim() : '0');

    if (!raw) return zeroBig(safeDecimals);

    try {
      if (window.ethers?.utils?.parseUnits) {
        return window.ethers.utils.parseUnits(raw, safeDecimals);
      }
    } catch {
      // Fallback
    }

    // String fallback: manual integer construction
    let neg = false;
    let s = raw;
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    if (!/^\d+(\.\d+)?$/.test(s)) return zeroBig(safeDecimals);
    const [i, dec = ''] = s.split('.');
    const merged = (i + (dec + '0'.repeat(safeDecimals))).slice(0, i.length + safeDecimals);
    const intStr = merged + (dec.length < safeDecimals ? '' : '');
    const cleaned = intStr.replace(/^0+/, '') || '0';
    return neg ? '-' + cleaned : cleaned;
  }

  function zeroBig(decimals) {
    if (window.ethers?.BigNumber) return window.ethers.BigNumber.from(0);
    return '0'.padEnd(decimals + 1, '0');
  }

  async function tryImpersonateAccount(provider, address) {
    if (!provider || !provider.send) return false;
    try {
      await provider.send('hardhat_impersonateAccount', [address]);
      return true;
    } catch (e) {
      try {
        await provider.send('anvil_impersonateAccount', [address]);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  async function trySetEthBalance(provider, address, balanceHex) {
    if (!provider || !provider.send) return false;
    try {
      await provider.send('hardhat_setBalance', [address, balanceHex]);
      return true;
    } catch (e) {
      try {
        await provider.send('anvil_setBalance', [address, balanceHex]);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  // =========================
  // STAPLE_EXPORT Exports
  // =========================
  window.stapleCommon = {
    // Basics
    debounce,
    pLimit,
    isValidUrl,
    isAddress,
    normalizeAddress,
    escapeHtml,
    showToast,
    setupCopyDelegation,
    tryImpersonateAccount,
    trySetEthBalance,

    // Preferred APIs
    formatNumber,       
    fromBigNumber,      
    toBigNumber,        

    // Exports
    getRpcProvider,
    isSigner,
    resolveSigner,
    getExplorerLink,
  };
})();
