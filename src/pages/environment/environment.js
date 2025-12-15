/*
 * Environment Configuration and Cache Module (refactored)
 * - Network/user persistence with migrations
 * - Derived contract/state caching per network
 * - Minimal dependencies: ethers, RpcManager, stapleCommon globals
 */

(function () {
  // ===== Constants =====
  const STORAGE = {
    USER: 'staple_env_user',
    NETWORK: 'staple_env_network',
    DERIVED: 'staple_env_contracts',
    CHAINLINK: 'staple_env_chainlink'
  };

  const DEFAULT_NETWORKS = {
    "Localhost": {
      chainID: 1,
      rpc: "http://127.0.0.1:18545",
      isProduction: false,
      deployerPrivateKey: "",
      contractDeployer: "0xC1A2F7F1Bd8D94f86fAFd04658b712ec9C91E802",
      contracts: {
        uiPoolDataProvider: "0xbd3b343fF4576E1A466e066CBE8b8713E3f82911",
        testERC20Factory: "0x2a206309Ac5633f57a3ed5060444ee6fAd77896a",
        poolImpl: "0x51179aE3a1a67f613A6E0bf39C1D919e113F06e4",
        stapleVerifier: "0x7c06E1348f6c3DEb9Ac59e9b86B44a168EF8483F",
        chainlinkDataFeedVerifier: "",
        chainlinkStreamVerifier: "",
        router: "0xa519BA3cee3f93b85DBcBfF8A0c3D10623124dB2",
        mockDexAggregator: "0xA473cc95CF82B5F2018BE045Ad3bBF0f18D36FAc"
      }
    },
    "Arbitrum-Sepolia": {
      chainID: 421614,
      rpc: "https://arbitrum-sepolia-rpc.publicnode.com",
      isProduction: true,
      deployerPrivateKey: "",
      contractDeployer: "0xC1A27b370c92cC52dBef4FCbDAb52fF488fAB000",
      contracts: {
        uiPoolDataProvider: "0xEB3fBA85C56183b842b8c7cE1f68481b85c2dD65",
        testERC20Factory: "0x3064a15fA0625187e92a6407786fE7D9CD207721",
        poolImpl: "0x9950A6141960897bBb83859c4b77744c295BE884",
        stapleVerifier: "0x006D928c212120071f0e33288EdEa0cA7F94a194",
        chainlinkDataFeedVerifier: "0x92b4B377680E990771d655b22def0eDC80f015b8",
        chainlinkStreamVerifier: "0xCB4f1F796feaD2cD2D70a04d71A04200CdaAC6Bc",
        router: "0x01A8EB6F9a96711605D641F5b68323E629494498",
        mockDexAggregator: "0x58fA3F5AB65f1D4e411D8a6aCa575378C58B3DC8"
      }
    },
    "Arbitrum-Sepolia-Local": {
      chainID: 421614,
      rpc: "http://127.0.0.1:18546",
      isProduction: false,
      deployerPrivateKey: "",
      contractDeployer: "0xC1A27b370c92cC52dBef4FCbDAb52fF488fAB000",
      contracts: {
        uiPoolDataProvider: "0xEB3fBA85C56183b842b8c7cE1f68481b85c2dD65",
        testERC20Factory: "0x3064a15fA0625187e92a6407786fE7D9CD207721",
        poolImpl: "0x9950A6141960897bBb83859c4b77744c295BE884",
        stapleVerifier: "0x006D928c212120071f0e33288EdEa0cA7F94a194",
        chainlinkDataFeedVerifier: "0x92b4B377680E990771d655b22def0eDC80f015b8",
        chainlinkStreamVerifier: "0xCB4f1F796feaD2cD2D70a04d71A04200CdaAC6Bc",
        router: "0x01A8EB6F9a96711605D641F5b68323E629494498",
        mockDexAggregator: "0x58fA3F5AB65f1D4e411D8a6aCa575378C58B3DC8"
      }
    }
  };

  // ===== State =====
  let currentNetworkName = "Arbitrum-Sepolia";
  let networks = {};
  let _provider = null;
  let _uiPoolContract = null;
  let _userList = [];
  let _selectedUser = "";
  let _chainlinkConfig = { chainlinkStreamApiKey: "", chainlinkStreamApiSecret: "" };
  let derivedState = {
    blockNumber: 0,
    blockTime: 0,
    controller: "",
    incentivesController: "",
    priceProvider: "",
    mockCurve: "",
    mockUniswapV2: "",
    mockUniswapV3: ""
  };
  let _derivedStateStore = {};
  let _lastPoolInfoRefresh = {};
  let _lastSymbolRefresh = {};
  let _envRefreshing = false;

  const COMMON = window.stapleCommon || {};

  // ===== Helpers =====
  const deepClone = (obj) => JSON.parse(JSON.stringify(obj || {}));
  const resetDerivedState = () => {
    derivedState = {
      blockNumber: 0,
      blockTime: 0,
      controller: "",
      incentivesController: "",
      priceProvider: "",
      mockCurve: "",
      mockUniswapV2: "",
      mockUniswapV3: ""
    };
  };

  const applyDerivedState = (src) => {
    if (!src) { resetDerivedState(); return; }
    derivedState.blockNumber = src.blockNumber || 0;
    derivedState.blockTime = src.blockTime || 0;
    derivedState.controller = src.controller || "";
    derivedState.incentivesController = src.incentivesController || "";
    derivedState.priceProvider = src.priceProvider || "";
    derivedState.mockCurve = src.mockCurve || "";
    derivedState.mockUniswapV2 = src.mockUniswapV2 || "";
    derivedState.mockUniswapV3 = src.mockUniswapV3 || "";
  };

  const normalizeAddress = (addr) => {
    if (!addr) return "";
    return COMMON.normalizeAddress ? COMMON.normalizeAddress(addr) : addr;
  };

  const ensureNetworks = () => {
    if (!networks || Object.keys(networks).length === 0) {
      networks = deepClone(DEFAULT_NETWORKS);
    }
  };

  const getCurrentNetwork = () => networks[currentNetworkName] || DEFAULT_NETWORKS[Object.keys(DEFAULT_NETWORKS)[0]];

  // ===== Persistence =====
  function persistEnv() {
    try {
      localStorage.setItem(STORAGE.USER, JSON.stringify({ userList: _userList, selectedUser: _selectedUser }));
      localStorage.setItem(STORAGE.CHAINLINK, JSON.stringify(_chainlinkConfig));

      const nets = deepClone(networks);
      Object.values(nets).forEach((n) => { if (!n) return; delete n.chainlinkStreamApiKey; delete n.chainlinkStreamApiSecret; });
      localStorage.setItem(STORAGE.NETWORK, JSON.stringify({ networks: nets, currentNetworkName }));

      const derivedMap = { map: deepClone(_derivedStateStore) };
      derivedMap.map[currentNetworkName] = deepClone({ ...derivedState });
      _derivedStateStore = deepClone(derivedMap.map);
      localStorage.setItem(STORAGE.DERIVED, JSON.stringify(derivedMap));
    } catch (e) { console.error('Persist failed', e); }
  }

  function loadEnv() {
    try {
      const userRaw = localStorage.getItem(STORAGE.USER);
      if (userRaw) {
        const parsed = JSON.parse(userRaw);
        if (Array.isArray(parsed.userList)) _userList = parsed.userList;
        else if (Array.isArray(parsed.users)) _userList = parsed.users.map((a) => ({ address: normalizeAddress(a), nickname: a }));
        else if (Array.isArray(parsed)) _userList = parsed.map((a) => ({ address: normalizeAddress(a), nickname: a }));
        _selectedUser = parsed.selectedUser || parsed.currentUser || _selectedUser;
      }
    } catch (_) {}

    try {
      const clRaw = localStorage.getItem(STORAGE.CHAINLINK);
      if (clRaw) {
        const parsed = JSON.parse(clRaw);
        if (parsed && typeof parsed === 'object') {
          _chainlinkConfig.chainlinkStreamApiKey = parsed.chainlinkStreamApiKey || "";
          _chainlinkConfig.chainlinkStreamApiSecret = parsed.chainlinkStreamApiSecret || "";
        }
      }
    } catch (_) {}

    try {
      const netRaw = localStorage.getItem(STORAGE.NETWORK);
      if (netRaw) {
        const parsed = JSON.parse(netRaw);
        if (parsed.networks) networks = parsed.networks;
        if (parsed.currentNetworkName && networks[parsed.currentNetworkName]) currentNetworkName = parsed.currentNetworkName;
      }
    } catch (_) {}

    ensureNetworks();

    Object.values(networks).forEach((n) => {
      if (!n) return;
      if (!_chainlinkConfig.chainlinkStreamApiKey && n.chainlinkStreamApiKey) _chainlinkConfig.chainlinkStreamApiKey = n.chainlinkStreamApiKey;
      if (!_chainlinkConfig.chainlinkStreamApiSecret && n.chainlinkStreamApiSecret) _chainlinkConfig.chainlinkStreamApiSecret = n.chainlinkStreamApiSecret;
      delete n.chainlinkStreamApiKey;
      delete n.chainlinkStreamApiSecret;
      if (n.contracts && n.contracts.contractDeployer) {
        n.contractDeployer = n.contractDeployer || n.contracts.contractDeployer;
        delete n.contracts.contractDeployer;
      }
    });

    try {
      const dRaw = localStorage.getItem(STORAGE.DERIVED);
      if (dRaw) {
        const parsed = JSON.parse(dRaw);
        if (parsed.map && typeof parsed.map === 'object') {
          _derivedStateStore = parsed.map;
        } else if (parsed.derivedState) {
          _derivedStateStore[currentNetworkName] = parsed.derivedState;
        }
      }
    } catch (_) {}

    if (!_derivedStateStore[currentNetworkName]) resetDerivedState();
    else applyDerivedState(_derivedStateStore[currentNetworkName]);

    if (!networks[currentNetworkName]) {
      currentNetworkName = Object.keys(networks)[0];
    }
  }

  // ===== Derived/Provider Refresh =====
  async function refreshProvider() {
    const net = getCurrentNetwork();
    if (!net.rpc) { _provider = null; return; }
    try {
      _provider = new ethers.providers.JsonRpcProvider(net.rpc);
      _provider.pollingInterval = 60000;
      if (window.RpcManager) window.RpcManager.init(net.rpc, net.chainID);
    } catch (e) {
      console.error('Invalid RPC', e);
      _provider = null;
    }
  }

  async function refreshBlockInfo() {
    if (!_provider) { derivedState.blockNumber = 0; derivedState.blockTime = 0; return; }
    try {
      const num = await _provider.getBlockNumber();
      const blk = await _provider.getBlock(num);
      derivedState.blockNumber = num;
      derivedState.blockTime = blk.timestamp;
    } catch (e) { console.warn('Block info failed', e); }
  }

  async function refreshPriceProvider() {
    try {
      if (typeof stapleControllerAbi !== 'undefined' && derivedState.controller && _provider) {
        const c = new ethers.Contract(derivedState.controller, stapleControllerAbi, _provider);
        derivedState.priceProvider = await c.priceProvider();
      } else {
        derivedState.priceProvider = "";
      }
    } catch (e) {
      console.error('priceProvider read failed', e);
      derivedState.priceProvider = "";
    }
  }

  async function refreshMockDexAddresses() {
    const net = getCurrentNetwork();
    const mockDexAggregator = net.contracts?.mockDexAggregator;
    try {
      if (typeof mockExternalDexExtentionsAbi !== 'undefined' && mockDexAggregator && _provider) {
        const dex = new ethers.Contract(mockDexAggregator, mockExternalDexExtentionsAbi, _provider);
        const [curve, v2, v3] = await Promise.all([
          dex.mockCurve().catch(() => ""),
          dex.mockUniswapV2().catch(() => ""),
          dex.mockUniswapV3().catch(() => "")
        ]);
        derivedState.mockCurve = curve || "";
        derivedState.mockUniswapV2 = v2 || "";
        derivedState.mockUniswapV3 = v3 || "";
      } else {
        derivedState.mockCurve = "";
        derivedState.mockUniswapV2 = "";
        derivedState.mockUniswapV3 = "";
      }
    } catch (e) {
      console.error('mock dex read failed', e);
      derivedState.mockCurve = "";
      derivedState.mockUniswapV2 = "";
      derivedState.mockUniswapV3 = "";
    }
  }

  async function refreshContractAndDerived(force = false) {
    if (_envRefreshing) return;
    _envRefreshing = true;
    render();

    const net = getCurrentNetwork();
    const uiPoolDataProvider = net.contracts?.uiPoolDataProvider;
    if (!_provider || !uiPoolDataProvider) {
      _uiPoolContract = null;
      resetDerivedState();
      persistEnv();
      _envRefreshing = false;
      render();
      return;
    }

    try {
      _uiPoolContract = new ethers.Contract(uiPoolDataProvider, stapleUIPoolDataProviderAbi, _provider);
    } catch (e) {
      console.error('UI Pool instantiate failed', e);
      _uiPoolContract = null;
      resetDerivedState();
      persistEnv();
      _envRefreshing = false;
      render();
      return;
    }

    if (!force && derivedState.controller && derivedState.incentivesController) {
      _envRefreshing = false;
      render();
      return;
    }

    try {
      const [c, ic] = await Promise.all([
        _uiPoolContract.controller(),
        _uiPoolContract.incentivesController()
      ]);
      derivedState.controller = c;
      derivedState.incentivesController = ic;
      await refreshPriceProvider();
      await refreshMockDexAddresses();
      persistEnv();
    } catch (e) {
      console.error('Derived read failed', e);
      resetDerivedState();
      persistEnv();
    } finally {
      _envRefreshing = false;
      render();
    }
  }

  async function tryReadControllers(provider, address) {
    const contract = new ethers.Contract(address, stapleUIPoolDataProviderAbi, provider);
    const [c, ic] = await Promise.all([contract.controller(), contract.incentivesController()]);
    return { contract, controller: c, incentivesController: ic };
  }

  // ===== Cache helpers =====
  const CACHE = {
    KEYS: { POOL_INFO_PREFIX: 'staple_cache_pool_info_', SYMBOLS: 'staple_cache_symbols' },
    TTL: { POOL_INFO: 10 * 60 * 1000, SYMBOLS: 24 * 60 * 60 * 1000 },
    THROTTLE: 10000
  };

  const cacheSuffix = () => {
    const net = getCurrentNetwork() || {};
    const chain = net.chainID || '0';
    return `${chain}_${currentNetworkName || 'default'}`;
  };
  const poolCacheKey = (userAddr) => CACHE.KEYS.POOL_INFO_PREFIX + cacheSuffix() + '_' + (userAddr || ethers.constants.AddressZero).toLowerCase();
  const symbolCacheKey = () => `${CACHE.KEYS.SYMBOLS}_${cacheSuffix()}`;
  const formatDuration = (ms) => {
    if (ms <= 0 || !Number.isFinite(ms)) return 'Expired';
    const sec = Math.floor(ms / 1000);
    const mins = Math.floor(sec / 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${sec % 60}s`;
    return `${sec}s`;
  };

  const normalizePoolData = (poolData) => {
    if (!Array.isArray(poolData)) return [];
    const normalizePoolParams = (p) => p ? { id: p.id, decimals: p.decimals, riskLevel: p.riskLevel, asset: p.asset, lpAddr: p.lpAddr } : null;
    const normalizePoolStatus = (s) => s ? { assets: s.assets, liability: s.liability } : null;
    const normalizeVtpParams = (p) => p ? { id: p.id, riskLevel: p.riskLevel, n: p.n, p: p.p } : null;
    const normalizeVtpStatus = (s) => s ? { po: s.po, pa: s.pa } : null;
    const normalizeVtpTokenParams = (p) => p ? {
      asset: p.asset,
      decimals: p.decimals,
      riskLevel: p.riskLevel,
      id: p.id,
      lpAddr: p.lpAddr,
      swapFeeIn: p.swapFeeIn,
      swapFeeOut: p.swapFeeOut,
      protocolFeeRate: p.protocolFeeRate,
      maxAllocateRate: p.maxAllocateRate,
      alrLowerBound: p.alrLowerBound
    } : null;
    const normalizeVtpTokenStatus = (s) => s ? {
      liability: s.liability,
      assets: s.assets,
      alr: s.alr,
      feeTotal: s.feeTotal,
      feePeriod: s.feePeriod,
      feeProtocol: s.feeProtocol,
      totalShares: s.totalShares,
      paused: s.paused
    } : null;
    const normalizeIncentives = (arr) => Array.isArray(arr) ? arr.map((i) => i ? ({
      id: i.id,
      token: i.token,
      decimals: i.decimals,
      startTime: i.startTime,
      endTime: i.endTime,
      emissionPerSecond: i.emissionPerSecond
    }) : null).filter(Boolean) : [];
    const normalizeVtpToken = (t) => t ? {
      params: normalizeVtpTokenParams(t.params),
      status: normalizeVtpTokenStatus(t.status),
      incentives: normalizeIncentives(t.incentives)
    } : null;
    const normalizeVtp = (v) => v ? {
      params: normalizeVtpParams(v.params),
      status: normalizeVtpStatus(v.status),
      token0: normalizeVtpToken(v.token0),
      token1: normalizeVtpToken(v.token1)
    } : null;
    return poolData.map((p) => ({
      params: normalizePoolParams(p.params),
      status: normalizePoolStatus(p.status),
      relatedVtps: Array.isArray(p.relatedVtps) ? p.relatedVtps.map(normalizeVtp).filter(Boolean) : []
    }));
  };

  async function refreshPoolInfo(force = false) {
    const now = Date.now();
    const ns = cacheSuffix();
    if (!force && now - (_lastPoolInfoRefresh[ns] || 0) < CACHE.THROTTLE) return;

    _envRefreshing = true; renderPoolInfo();

    if (!_uiPoolContract) {
      try { await refreshContractAndDerived(); } catch (e) { console.error(e); }
      if (!_uiPoolContract) { _envRefreshing = false; renderPoolInfo(); return; }
    }

    const userAddr = _selectedUser || ethers.constants.AddressZero;
    try {
      const overrides = userAddr !== ethers.constants.AddressZero ? { from: userAddr } : {};
      const rawPoolData = await _uiPoolContract.getAllPools(overrides);
      const poolData = normalizePoolData(rawPoolData);
      const poolLength = poolData.length;
      let totalVtp = 0; poolData.forEach((p) => { if (p.relatedVtps) totalVtp += p.relatedVtps.length; });
      const vtpLength = Math.floor(totalVtp / 2);

      const cacheData = { timestamp: now, poolLength, vtpLength, data: poolData };
      localStorage.setItem(poolCacheKey(userAddr), JSON.stringify(cacheData, (k, v) => v && v.type === 'BigNumber' ? v.hex : v));
      _lastPoolInfoRefresh[ns] = now;
      _envRefreshing = false;
      renderPoolInfo();
      refreshSymbols(false).catch(console.error);
    } catch (e) {
      console.error('Pool refresh failed', e);
      _envRefreshing = false;
      renderPoolInfo();
    }
  }

  async function refreshSymbols(force = false) {
    const now = Date.now();
    const ns = cacheSuffix();
    if (!force && now - (_lastSymbolRefresh[ns] || 0) < CACHE.THROTTLE) return;

    try {
      const assets = new Set();
      const net = getCurrentNetwork();
      if (net.contracts.testERC20Factory && _provider) {
        try {
          const factory = new ethers.Contract(net.contracts.testERC20Factory, stapleTestERC20FactoryAbi, _provider);
          const tokens = await factory.supportedTokens();
          if (Array.isArray(tokens)) tokens.forEach((t) => assets.add(t.toLowerCase()));
        } catch (e) { console.warn('Factory tokens failed', e); }
      }

      const userAddr = _selectedUser || ethers.constants.AddressZero;
      const poolCacheRaw = localStorage.getItem(poolCacheKey(userAddr));
      if (poolCacheRaw) {
        try {
          const cache = JSON.parse(poolCacheRaw);
          if (cache.data && Array.isArray(cache.data)) {
            cache.data.forEach((p) => {
              if (p.params) {
                if (p.params.asset) assets.add(p.params.asset.toLowerCase());
                if (p.params.lpAddr) assets.add(p.params.lpAddr.toLowerCase());
              }
            });
          }
        } catch (_) {}
      }

      const assetArray = Array.from(assets);
      if (assetArray.length === 0) return;

      if (!window.RpcManager || typeof window.RpcManager.multicall !== 'function') {
        console.warn('RpcManager unavailable; skipping symbol refresh');
        return;
      }

      const calls = assetArray.map((addr) => ({ target: addr, abi: ['function symbol() view returns (string)'], method: 'symbol', params: [], allowFailure: true }));
      let symbols = [];
      try { symbols = await window.RpcManager.multicall(calls); } catch (e) { console.error('Symbol multicall failed', e); symbols = new Array(assetArray.length).fill(null); }

      const symbolMap = {};
      assetArray.forEach((addr, i) => { if (symbols[i]) symbolMap[addr] = symbols[i]; });
      localStorage.setItem(symbolCacheKey(), JSON.stringify({ timestamp: now, data: symbolMap }));
      _lastSymbolRefresh[ns] = now;
    } catch (e) { console.error('Symbols refresh failed', e); }
  }

  function getPoolInfo() {
    const userAddr = _selectedUser || ethers.constants.AddressZero;
    const raw = localStorage.getItem(poolCacheKey(userAddr));
    if (!raw) throw new Error('Pool Info Cache Missing');
    const cache = JSON.parse(raw);
    if (Date.now() - cache.timestamp > CACHE.TTL.POOL_INFO) throw new Error('Pool Info Cache Expired');
    if (cache.data && Array.isArray(cache.data) && cache.data.length > 0 && !cache.data[0].params) throw new Error('Pool Info Cache Malformed');
    return cache;
  }

  function getSymbols() {
    const raw = localStorage.getItem(symbolCacheKey());
    if (!raw) throw new Error('Symbol Cache Missing');
    const cache = JSON.parse(raw);
    if (Date.now() - cache.timestamp > CACHE.TTL.SYMBOLS) throw new Error('Symbol Cache Expired');
    return cache.data;
  }

  // ===== UI helpers =====
  function renderAddr(el, addr, opts = {}) {
    if (!el) return;
    const { loading, chainID, isProd } = opts;
    const loadingText = 'Loading...';
    if (loading) { el.textContent = loadingText; return; }
    if (!addr || addr === ethers.constants.AddressZero) { el.textContent = addr || ''; return; }
    if (isProd && chainID && window.stapleCommon && window.stapleCommon.getExplorerLink) {
      const link = window.stapleCommon.getExplorerLink(chainID, addr);
      if (link) { el.innerHTML = `<a href="${link}" target="_blank" rel="noopener noreferrer" style="text-decoration: underline;">${addr}</a>`; return; }
    }
    el.textContent = addr;
  }

  function renderUsers() {
    const userListContainer = document.getElementById('user-list-container');
    if (!userListContainer) return;
    userListContainer.innerHTML = '';
    if (_userList.length === 0) {
      userListContainer.innerHTML = '<div class="empty-state">No users added yet.</div>';
      return;
    }
    _userList.forEach((u, idx) => {
      const isSelected = _selectedUser && u.address.toLowerCase() === _selectedUser.toLowerCase();
      const item = document.createElement('div');
      item.className = `user-item ${isSelected ? 'active' : ''}`;
      const hasPk = !!u.privateKey;
      item.innerHTML = `
        <div class="user-item-content">
          <div class="user-header">
            <span class="user-nickname">${u.nickname || 'User ' + (idx + 1)}</span>
            ${isSelected ? '<span class="badge-active">Active</span>' : ''}
          </div>
          <div class="user-address mono">${u.address}</div>
          <div class="user-pk-status ${hasPk ? 'ok' : 'missing'}">${hasPk ? 'PK Configured' : 'No Private Key'}</div>
        </div>
        <div class="user-item-actions">
          ${!isSelected ? `<button class="btn btn-sm btn-secondary" onclick="window.environment.selectUser('${u.address}')">Select</button>` : ''}
          <button class="btn btn-sm btn-secondary" onclick="window.environment.editUser('${u.address}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="window.environment.deleteUser('${u.address}')">Delete</button>
        </div>`;
      userListContainer.appendChild(item);
    });
  }

  function renderNetworks() {
    const netSelect = document.getElementById('network-select');
    if (!netSelect) return;
    while (netSelect.firstChild) netSelect.removeChild(netSelect.firstChild);
    ensureNetworks();
    Object.keys(networks).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name; if (name === currentNetworkName) opt.selected = true; netSelect.appendChild(opt);
    });
  }

  function renderPoolInfo() {
    const statusEl = document.getElementById('pool-info-status');
    const tsEl = document.getElementById('pool-info-timestamp');
    const ttlEl = document.getElementById('pool-info-ttl');
    const expiresEl = document.getElementById('pool-info-expires');
    const lenEl = document.getElementById('pool-info-length');
    const vtpEl = document.getElementById('pool-info-vtp-length');
    const previewEl = document.getElementById('pool-info-preview');
    if (!statusEl) return;
    try {
      const info = getPoolInfo();
      statusEl.textContent = 'Cached'; statusEl.className = 'badge badge-success';
      if (tsEl) tsEl.textContent = new Date(info.timestamp).toLocaleString();
      if (ttlEl) ttlEl.textContent = formatDuration(CACHE.TTL.POOL_INFO);
      if (expiresEl) expiresEl.textContent = formatDuration(CACHE.TTL.POOL_INFO - (Date.now() - info.timestamp));
      if (lenEl) lenEl.textContent = info.poolLength;
      if (vtpEl) vtpEl.textContent = info.vtpLength;
      if (previewEl) previewEl.textContent = JSON.stringify(info.data, null, 2);
    } catch (e) {
      statusEl.textContent = _envRefreshing ? 'Loading' : (e.message.includes('Expired') ? 'Expired' : 'Missing');
      statusEl.className = _envRefreshing ? 'badge badge-info' : 'badge badge-warning';
      if (tsEl) tsEl.textContent = '-';
      if (ttlEl) ttlEl.textContent = formatDuration(CACHE.TTL.POOL_INFO);
      if (expiresEl) expiresEl.textContent = _envRefreshing ? 'Loading...' : '-';
      if (lenEl) lenEl.textContent = '-';
      if (vtpEl) vtpEl.textContent = '-';
      if (previewEl) previewEl.textContent = _envRefreshing ? 'Loading...' : 'No valid cache found.';
    }
  }

  function renderSymbols() {
    const statusEl = document.getElementById('symbols-status');
    const tsEl = document.getElementById('symbols-timestamp');
    const ttlEl = document.getElementById('symbols-ttl');
    const expiresEl = document.getElementById('symbols-expires');
    const countEl = document.getElementById('symbols-count');
    const listEl = document.getElementById('symbols-list');
    if (!statusEl) return;
    try {
      const symbols = getSymbols();
      const keys = Object.keys(symbols);
      const raw = localStorage.getItem(symbolCacheKey());
      const ts = raw ? JSON.parse(raw).timestamp : 0;
      statusEl.textContent = 'Cached'; statusEl.className = 'badge badge-success';
      if (tsEl) tsEl.textContent = new Date(ts).toLocaleString();
      if (ttlEl) ttlEl.textContent = formatDuration(CACHE.TTL.SYMBOLS);
      if (expiresEl) expiresEl.textContent = formatDuration(CACHE.TTL.SYMBOLS - (Date.now() - ts));
      if (countEl) countEl.textContent = keys.length;
      if (listEl) {
        listEl.innerHTML = '';
        keys.sort((a, b) => {
          const sa = (symbols[a] || '').toLowerCase();
          const sb = (symbols[b] || '').toLowerCase();
          if (sa === sb) return a.localeCompare(b);
          return sa.localeCompare(sb);
        }).forEach((addr) => {
          const addrId = `symbol-addr-${addr.slice(2)}`;
          const row = document.createElement('div');
          row.className = 'symbol-item';
          row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.justifyContent = 'space-between'; row.style.gap = '8px'; row.style.border = '1px solid #eee'; row.style.borderRadius = '6px'; row.style.padding = '8px 10px'; row.style.fontSize = '0.9em';
          const left = document.createElement('div'); left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '10px';
          const symSpan = document.createElement('span'); symSpan.style.fontWeight = '600'; symSpan.textContent = symbols[addr];
          const addrSpan = document.createElement('span'); addrSpan.id = addrId; addrSpan.className = 'mono'; addrSpan.style.fontSize = '0.85em'; addrSpan.textContent = addr;
          left.appendChild(symSpan); left.appendChild(addrSpan);
          const copyBtn = document.createElement('button'); copyBtn.className = 'btn-icon copy-btn'; copyBtn.setAttribute('data-copy-target', addrId); copyBtn.textContent = '📋';
          row.appendChild(left); row.appendChild(copyBtn); listEl.appendChild(row);
        });
      }
    } catch (e) {
      statusEl.textContent = _envRefreshing ? 'Loading' : (e.message.includes('Expired') ? 'Expired' : 'Missing');
      statusEl.className = _envRefreshing ? 'badge badge-info' : 'badge badge-warning';
      if (tsEl) tsEl.textContent = '-';
      if (ttlEl) ttlEl.textContent = formatDuration(CACHE.TTL.SYMBOLS);
      if (expiresEl) expiresEl.textContent = _envRefreshing ? 'Loading...' : '-';
      if (countEl) countEl.textContent = '-';
      if (listEl) listEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #999;">No symbols cached</div>';
    }
  }

  function getAllParams() {
    const net = getCurrentNetwork();
    const contracts = net.contracts || {};
    return {
      currentNetworkName,
      chainID: net.chainID,
      rpc: net.rpc,
      isProduction: !!net.isProduction,
      deployerPrivateKey: net.deployerPrivateKey || "",
      contractDeployer: net.contractDeployer || "",
      uiPoolDataProvider: contracts.uiPoolDataProvider || "",
      testERC20Factory: contracts.testERC20Factory || "",
      poolImpl: contracts.poolImpl || "",
      stapleVerifier: contracts.stapleVerifier || "",
      chainlinkDataFeedVerifier: contracts.chainlinkDataFeedVerifier || "",
      chainlinkStreamVerifier: contracts.chainlinkStreamVerifier || "",
      router: contracts.router || "",
      mockDexAggregator: contracts.mockDexAggregator || "",
      chainlinkStreamApiKey: _chainlinkConfig.chainlinkStreamApiKey || "",
      chainlinkStreamApiSecret: _chainlinkConfig.chainlinkStreamApiSecret || "",
      blockNumber: derivedState.blockNumber,
      blockTime: derivedState.blockTime,
      controller: derivedState.controller,
      incentivesController: derivedState.incentivesController,
      priceProvider: derivedState.priceProvider,
      mockCurve: derivedState.mockCurve,
      mockUniswapV2: derivedState.mockUniswapV2,
      mockUniswapV3: derivedState.mockUniswapV3,
      user: _selectedUser || ethers.constants.AddressZero
    };
  }

  function render() {
    const params = getAllParams();
    renderNetworks();

    const isLoading = _envRefreshing;
    const isProd = params.isProduction;
    const chainID = params.chainID;

    renderAddr(document.getElementById('current-uiPoolDataProvider'), params.uiPoolDataProvider, { chainID, isProd });
    renderAddr(document.getElementById('current-controller'), params.controller, { chainID, isProd, loading: isLoading });
    renderAddr(document.getElementById('current-incentivesController'), params.incentivesController, { chainID, isProd, loading: isLoading });
    renderAddr(document.getElementById('current-testERC20Factory'), params.testERC20Factory || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-priceProvider'), params.priceProvider, { chainID, isProd, loading: isLoading });
    renderAddr(document.getElementById('current-poolImpl'), params.poolImpl, { chainID, isProd });
    renderAddr(document.getElementById('current-contractDeployer'), params.contractDeployer || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-stapleVerifier'), params.stapleVerifier || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-chainlinkDataFeedVerifier'), params.chainlinkDataFeedVerifier || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-chainlinkStreamVerifier'), params.chainlinkStreamVerifier || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-router'), params.router || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-mockDexAggregator'), params.mockDexAggregator || ethers.constants.AddressZero, { chainID, isProd });
    renderAddr(document.getElementById('current-mockCurve'), params.mockCurve, { chainID, isProd, loading: isLoading });
    renderAddr(document.getElementById('current-mockUniswapV2'), params.mockUniswapV2, { chainID, isProd, loading: isLoading });
    renderAddr(document.getElementById('current-mockUniswapV3'), params.mockUniswapV3, { chainID, isProd, loading: isLoading });

    const chainIdEl = document.getElementById('current-chainID'); if (chainIdEl) chainIdEl.textContent = params.chainID || '';
    const blockNumEl = document.getElementById('current-block-number'); if (blockNumEl) blockNumEl.textContent = params.blockNumber || '';
    const blockTimeEl = document.getElementById('current-block-time'); if (blockTimeEl) blockTimeEl.textContent = params.blockTime || '';
    const rpcEl = document.getElementById('current-rpc'); if (rpcEl) rpcEl.textContent = params.rpc || '';
    const chainlinkApiEl = document.getElementById('current-chainlinkStreamApiKey'); if (chainlinkApiEl) { const has = !!params.chainlinkStreamApiKey; chainlinkApiEl.textContent = has ? params.chainlinkStreamApiKey : 'Not Set'; chainlinkApiEl.style.color = has ? 'inherit' : 'red'; }
    const chainlinkSecEl = document.getElementById('current-chainlinkStreamApiSecret'); if (chainlinkSecEl) { const has = !!params.chainlinkStreamApiSecret; chainlinkSecEl.textContent = has ? '***' : 'Not Set'; chainlinkSecEl.style.color = has ? 'green' : 'red'; }

    const isProdEl = document.getElementById('current-is-production'); if (isProdEl) isProdEl.textContent = params.isProduction ? 'Production' : 'Local/Test';
    const isProdInput = document.getElementById('input-is-production'); if (isProdInput) isProdInput.checked = params.isProduction;
    const deployerStatusEl = document.getElementById('current-deployer-pk-status'); if (deployerStatusEl) { deployerStatusEl.textContent = params.deployerPrivateKey ? 'Configured (Hidden)' : 'Not Set'; deployerStatusEl.style.color = params.deployerPrivateKey ? 'green' : 'red'; }

    renderUsers();
    renderPoolInfo();
    renderSymbols();
  }

  // ===== Actions =====
  function addUser(addressOrPk, nickname) {
    let addr = (addressOrPk || '').trim();
    let pk = "";
    if (addr.length === 66 && addr.startsWith('0x')) {
      try { const wallet = new ethers.Wallet(addr); addr = wallet.address; pk = wallet.privateKey; } catch (_) {}
    }
    const addrNorm = normalizeAddress(addr);
    if (!addrNorm || !COMMON.isAddress || !COMMON.isAddress(addrNorm)) { alert('Address or Private Key format is incorrect'); return false; }
    const existingIdx = _userList.findIndex((u) => u.address.toLowerCase() === addrNorm.toLowerCase());
    if (existingIdx >= 0) {
      if (pk) _userList[existingIdx].privateKey = pk;
      if (nickname) _userList[existingIdx].nickname = nickname;
      _selectedUser = _userList[existingIdx].address; persistEnv(); renderUsers(); return true;
    }
    const nick = (nickname || '').trim() || `${addrNorm.slice(0, 6)}...${addrNorm.slice(-4)}`;
    _userList.push({ address: addrNorm, nickname: nick, privateKey: pk });
    _selectedUser = addrNorm;
    persistEnv(); renderUsers(); return true;
  }

  function setSelectedUser(address) {
    if (!address) { _selectedUser = ""; persistEnv(); renderUsers(); return; }
    const addrNorm = normalizeAddress(address); if (!addrNorm) return;
    if (!_userList.some((u) => u.address.toLowerCase() === addrNorm.toLowerCase())) return;
    _selectedUser = addrNorm; persistEnv(); renderUsers();
  }

  function deleteUser(address) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    _userList = _userList.filter((u) => u.address.toLowerCase() !== address.toLowerCase());
    if (_selectedUser && _selectedUser.toLowerCase() === address.toLowerCase()) _selectedUser = "";
    persistEnv(); renderUsers();
  }

  function editUser(address) {
    const user = _userList.find((u) => u.address.toLowerCase() === address.toLowerCase());
    if (!user) return;
    const newNick = prompt('Edit Nickname:', user.nickname);
    if (newNick !== null) { user.nickname = newNick; persistEnv(); renderUsers(); }
  }

  function createNewNetwork(name) {
    if (networks[name]) { alert('Network name already exists'); return false; }
    networks[name] = { chainID: 0, rpc: "", isProduction: false, deployerPrivateKey: "", contractDeployer: "", contracts: {} };
    currentNetworkName = name; resetDerivedState(); persistEnv(); return true;
  }

  async function setParam(key, value) {
    let net = getCurrentNetwork();
    switch (key) {
      case 'chainID': {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) { alert('Invalid chainID'); return; }
        net.chainID = parsed; persistEnv(); break;
      }
      case 'rpc': {
        const newRpc = value;
        let tmpProvider;
        try {
          // Prevent mutating baked-in defaults; clone to a custom entry before editing
          if (DEFAULT_NETWORKS[currentNetworkName]) {
            const newName = prompt(`Default network "${currentNetworkName}" is read-only. Enter a name to clone and edit:`, `${currentNetworkName}-Custom`);
            if (!newName) return; // cancelled
            if (networks[newName]) { alert('Network name already exists. Choose another name.'); return; }
            networks[newName] = deepClone(networks[currentNetworkName]);
            networks[newName].contracts = {}; // avoid stale addresses after cloning
            currentNetworkName = newName;
            net = getCurrentNetwork();
          }

          tmpProvider = new ethers.providers.JsonRpcProvider(newRpc);
          const network = await tmpProvider.getNetwork();
          const newChainID = network.chainId;
          net.rpc = newRpc; net.chainID = newChainID; persistEnv();
          await refreshProvider(); await refreshBlockInfo();
          if (net.contracts?.uiPoolDataProvider) await refreshContractAndDerived(true); else resetDerivedState();
          persistEnv();
        } catch (e) { alert(`Failed to update rpc: ${e?.message || e}`); return; }
        break;
      }
      case 'isProduction': { net.isProduction = !!value; persistEnv(); break; }
      case 'deployerPrivateKey': { net.deployerPrivateKey = value; persistEnv(); break; }
      case 'contractDeployer': {
        const maybe = String(value || '').trim();
        if (!COMMON.isAddress || !COMMON.isAddress(maybe)) { alert('contractDeployer address format is incorrect'); return; }
        net.contractDeployer = maybe; persistEnv(); break;
      }
      case 'uiPoolDataProvider': {
        const newAddr = value;
        let providerToUse = _provider;
        if (!providerToUse) { if (net.rpc) providerToUse = new ethers.providers.JsonRpcProvider(net.rpc); else { alert('Please set a valid rpc first'); return; } }
        try {
          const { contract, controller, incentivesController } = await tryReadControllers(providerToUse, newAddr);
          net.contracts = { ...net.contracts, uiPoolDataProvider: newAddr };
          _uiPoolContract = contract; derivedState.controller = controller; derivedState.incentivesController = incentivesController;
          await refreshPriceProvider(); await refreshMockDexAddresses();
          persistEnv();
        } catch (e) { alert(`Failed to update uiPoolDataProvider: ${e?.message || e}`); return; }
        break;
      }
      case 'chainlinkStreamApiKey':
      case 'chainlinkStreamApiSecret': {
        const mapKey = key === 'chainlinkStreamApiKey' ? 'chainlinkStreamApiKey' : 'chainlinkStreamApiSecret';
        _chainlinkConfig[mapKey] = String(value || '').trim();
        persistEnv(); break;
      }
      case 'testERC20Factory':
      case 'poolImpl':
      case 'stapleVerifier':
      case 'chainlinkDataFeedVerifier':
      case 'chainlinkStreamVerifier':
      case 'router':
      case 'mockDexAggregator': {
        const maybeAddr = String(value || '').trim();
        if (!COMMON.isAddress || !COMMON.isAddress(maybeAddr)) { alert(`${key} address format is incorrect`); return; }
        net.contracts = { ...net.contracts, [key]: maybeAddr }; persistEnv();
        if (key === 'mockDexAggregator') await refreshMockDexAddresses();
        break;
      }
      case 'user': {
        const addr = String(value || '').trim();
        if (!COMMON.isAddress || !COMMON.isAddress(addr)) { alert('user address format is incorrect'); return; }
        addUser(addr); break;
      }
      default: break;
    }
    render();
  }

  function clearEnvCache(category) {
    if (category === 'user') { localStorage.removeItem(STORAGE.USER); _userList = []; _selectedUser = ""; }
    else if (category === 'network') { localStorage.removeItem(STORAGE.NETWORK); networks = deepClone(DEFAULT_NETWORKS); currentNetworkName = 'Arbitrum-Sepolia'; }
    else if (category === 'contracts') { localStorage.removeItem(STORAGE.DERIVED); resetDerivedState(); _derivedStateStore = {}; }
    persistEnv(); location.reload();
  }

  // ===== Wiring =====
  function wireRow(idBase, key, validator) {
    const input = document.getElementById(`input-${idBase}`);
    const btn = document.getElementById(`submit-${idBase}`);
    if (!input || !btn) return;
    async function submit() {
      const val = (input.value || '').trim();
      if (!val && key !== 'deployerPrivateKey') { alert(`Please enter ${key}`); return; }
      if (validator && !validator(val)) { alert(`${key} format is incorrect`); return; }
      try { await setParam(key, val); input.value = ''; const editForm = document.getElementById(`edit-${idBase}`); if (editForm) editForm.classList.add('hidden'); } catch (e) { alert(e?.message || 'Update failed'); }
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // ===== Init =====
  loadEnv();

  document.addEventListener('DOMContentLoaded', function () {
    render();

    const netSelect = document.getElementById('network-select');
    if (netSelect) {
      netSelect.addEventListener('change', async (e) => {
        const newNet = e.target.value;
        if (newNet && networks[newNet]) {
          currentNetworkName = newNet;
          applyDerivedState(_derivedStateStore[newNet]);
          persistEnv();
          render();
          const net = getCurrentNetwork();
          if (net.rpc) await refreshProvider();
          if (net.rpc) await refreshBlockInfo();
          if (net.contracts?.uiPoolDataProvider) await refreshContractAndDerived();
          render();
        }
      });
    }

    const newNetBtn = document.getElementById('btn-new-network');
    if (newNetBtn) newNetBtn.addEventListener('click', () => { const name = prompt('Enter new network name:'); if (name && name.trim()) { if (createNewNetwork(name.trim())) render(); } });

    const btnIsProd = document.getElementById('submit-is-production');
    const inputIsProd = document.getElementById('input-is-production');
    if (btnIsProd && inputIsProd) btnIsProd.addEventListener('click', () => { setParam('isProduction', inputIsProd.checked); const editForm = document.getElementById('edit-is-production'); if (editForm) editForm.classList.add('hidden'); });

    wireRow('deployer-pk', 'deployerPrivateKey');
    wireRow('chainID', 'chainID');
    wireRow('rpc', 'rpc', COMMON.isValidUrl);
    wireRow('uiPoolDataProvider', 'uiPoolDataProvider', COMMON.isAddress);
    wireRow('testERC20Factory', 'testERC20Factory', COMMON.isAddress);
    wireRow('poolImpl', 'poolImpl', COMMON.isAddress);
    wireRow('contractDeployer', 'contractDeployer', COMMON.isAddress);
    wireRow('stapleVerifier', 'stapleVerifier', COMMON.isAddress);
    wireRow('chainlinkDataFeedVerifier', 'chainlinkDataFeedVerifier', COMMON.isAddress);
    wireRow('chainlinkStreamVerifier', 'chainlinkStreamVerifier', COMMON.isAddress);
    wireRow('chainlinkStreamApiKey', 'chainlinkStreamApiKey');
    wireRow('chainlinkStreamApiSecret', 'chainlinkStreamApiSecret');
    wireRow('router', 'router', COMMON.isAddress);
    wireRow('mockDexAggregator', 'mockDexAggregator', COMMON.isAddress);

    const addBtn = document.getElementById('submit-user-add');
    const addrInput = document.getElementById('input-user-address');
    const pkInput = document.getElementById('input-user-pk');
    const nickInput = document.getElementById('input-user-nickname');
    if (pkInput && addrInput) {
      pkInput.addEventListener('input', () => {
        const val = pkInput.value.trim();
        try {
          if (val) { const wallet = new ethers.Wallet(val); addrInput.value = wallet.address; addrInput.readOnly = true; addrInput.style.backgroundColor = '#f0f0f0'; }
          else { addrInput.readOnly = false; addrInput.style.backgroundColor = ''; }
        } catch (_) { addrInput.readOnly = false; addrInput.style.backgroundColor = ''; }
      });
    }
    if (addBtn) {
      async function addHandler() {
        const addr = (addrInput ? addrInput.value : '').trim();
        const pk = (pkInput ? pkInput.value : '').trim();
        const nick = (nickInput ? nickInput.value : '').trim();
        if (!addr && !pk) { alert('Please enter address or private key'); return; }
        let finalInput = addr;
        if (pk) {
          try { const wallet = new ethers.Wallet(pk); finalInput = pk; addrInput.value = wallet.address; }
          catch (e) { if (!confirm('Invalid PK. Continue with address only?')) return; if (!COMMON.isAddress(addr)) { alert('Invalid address.'); return; } finalInput = addr; }
        }
        if (addUser(finalInput, nick)) { if (addrInput) { addrInput.value = ''; addrInput.readOnly = false; addrInput.style.backgroundColor = ''; } if (pkInput) pkInput.value = ''; if (nickInput) nickInput.value = ''; }
      }
      addBtn.addEventListener('click', addHandler);
    }
    
    // Random wallet generation button
    const randomBtn = document.getElementById('btn-generate-random');
    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        try {
          // Generate a random wallet using ethers.js
          const wallet = ethers.Wallet.createRandom();
          const addr = wallet.address;
          const pk = wallet.privateKey;
          
          // Fill the form inputs
          if (addrInput) {
            addrInput.value = addr;
            addrInput.readOnly = true;
            addrInput.style.backgroundColor = '#f0f0f0';
          }
          if (pkInput) pkInput.value = pk;
          
          // Set default nickname: Random User 0xXXXX (first 4 chars after 0x)
          if (nickInput) nickInput.value = `Random User ${addr.slice(0, 6)}`;
          
        } catch (e) {
          console.error('Failed to generate random wallet:', e);
          alert('Failed to generate random wallet: ' + (e?.message || e));
        }
      });
    }

    const userSelect = document.getElementById('user-select');
    if (userSelect) userSelect.addEventListener('change', () => { const val = userSelect.value; setSelectedUser(val); });

    (COMMON.setupCopyDelegation || function(){})();

    const btnRefreshPool = document.getElementById('btn-refresh-pool-info');
    if (btnRefreshPool) btnRefreshPool.addEventListener('click', async () => {
      btnRefreshPool.disabled = true; btnRefreshPool.textContent = 'Refreshing...';
      try { const net = getCurrentNetwork(); if (net.rpc) await refreshProvider(); if (net.contracts?.uiPoolDataProvider) await refreshContractAndDerived(true); await refreshPoolInfo(true); renderPoolInfo(); }
      catch (e) { alert('Failed to refresh Pool Info: ' + (e?.message || e)); }
      finally { btnRefreshPool.disabled = false; btnRefreshPool.textContent = 'Force Refresh'; }
    });

    const btnRefreshSymbols = document.getElementById('btn-refresh-symbols');
    if (btnRefreshSymbols) btnRefreshSymbols.addEventListener('click', async () => {
      btnRefreshSymbols.disabled = true; btnRefreshSymbols.textContent = 'Refreshing...';
      try { const net = getCurrentNetwork(); if (net.rpc) await refreshProvider(); if (net.contracts?.uiPoolDataProvider) await refreshContractAndDerived(true); await refreshPoolInfo(true); await refreshSymbols(true); renderSymbols(); }
      catch (e) { alert('Failed to refresh Symbols: ' + (e?.message || e)); }
      finally { btnRefreshSymbols.disabled = false; btnRefreshSymbols.textContent = 'Force Refresh'; }
    });

    (async () => {
      try {
        const net = getCurrentNetwork();
        if (net.rpc) await refreshProvider();
        if (net.rpc) await refreshBlockInfo();
        if (net.contracts?.uiPoolDataProvider) {
          await refreshContractAndDerived();
          try { getPoolInfo(); } catch (_) { await refreshPoolInfo(); }
        }
      } catch (e) { console.error(e); }
      render();
    })();
  });

  window.addEventListener('storage', () => { loadEnv(); render(); });

  window.toggleEdit = function (id) { const el = document.getElementById(id); if (el) { el.classList.toggle('hidden'); if (!el.classList.contains('hidden')) { const input = el.querySelector('input'); if (input) input.focus(); } } };

  window.environment = {
    setParam,
    getAllParams,
    addUser,
    getUserList: () => _userList.slice(),
    selectUser: setSelectedUser,
    deleteUser,
    editUser,
    resetContracts: function () { const def = DEFAULT_NETWORKS[currentNetworkName]; if (!def) { alert('No default config for this network.'); return; } if (!confirm(`Reset contracts for ${currentNetworkName} to defaults?`)) return; networks[currentNetworkName].contracts = deepClone(def.contracts); resetDerivedState(); persistEnv(); (async () => { const net = getCurrentNetwork(); if (net.contracts?.uiPoolDataProvider) await refreshContractAndDerived(); render(); alert('Contracts reset to defaults.'); })(); },
    refreshPoolInfo,
    refreshSymbols,
    getPoolInfo,
    getSymbols,
    clearEnvCache
  };

  // Expose clear cache shortcut used by HTML onclick handlers
  window.clearEnvCache = clearEnvCache;
})();



