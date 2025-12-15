// Utility function to build PriceProvider verification payload.
// Logic encapsulation only, not displayed on page. Usage:
// const { encoded, payload, groups } = await window.buildPriceProviderVerificationPayload(tokens, { priceProviderAddress });
// Note:
// - CHAINLINK_STREAM_v1 and REDSTONE_v1 bytes construction have TODOs, placeholder is "0x" or encoded based on placeholder.
// - If real chainlinkStreamReports/redstonePayload is needed, please implement in TODO.

// Dependencies: ethers.js
(async function attach() {
  if (typeof window === "undefined") return;

  const zeroAddress = "0x0000000000000000000000000000000000000000";

  /**
   * Reserved: Get single Chainlink Stream report
   * @param {string} token
   * @param {ethers.Contract} verifier
   * @returns {Promise<string>} bytes (single report)
   */
  async function fetchChainlinkStreamReport(token, verifier) {
    const provider = window.stapleCommon.getRpcProvider();
    const { chainId } = await provider.getNetwork();
    if (chainId !== 421614) {
        throw new Error(`Chainlink Stream only supports Arbitrum Sepolia (421614), current Chain ID: ${chainId}`);
    }

    try {
        // 1. Get Feed ID from Verifier Contract
        const abi = ["function feedIDs(address) view returns (bytes32)"];
        // Use global provider to avoid signer issues
        const contract = new ethers.Contract(verifier.address, abi, provider);
        const feedID = await contract.feedIDs(token);
        
        if (!feedID || feedID === "0x0000000000000000000000000000000000000000000000000000000000000000") {
            console.warn(`[fetchChainlinkStreamReport] No feedID found for token ${token}`);
            return "0x";
        }

        // 2. Get API Config
        const env = window.environment.getAllParams();
        const apiKey = env.chainlinkStreamApiKey;
        const apiSecret = env.chainlinkStreamApiSecret;
        
        if (!apiKey || !apiSecret) {
             console.warn("[fetchChainlinkStreamReport] Chainlink API Key/Secret not set");
             return "0x";
        }
        
        // 3. Fetch Report
        if (!window.ChainlinkStream) {
            console.warn("[fetchChainlinkStreamReport] ChainlinkStream library not loaded");
            return "0x";
        }

        const config = new window.ChainlinkStream.Config(
            apiKey,
            apiSecret,
            "https://api.testnet-dataengine.chain.link"
        );
        const client = new window.ChainlinkStream.Client(config);
        
        const report = await client.getLatestReport(feedID);
        if (report && (report.fullReport || report.report)) {
             return report.fullReport || report.report;
        }
        
        console.warn("[fetchChainlinkStreamReport] Report not found in response", report);
        return "0x";
    } catch (e) {
        console.warn("[fetchChainlinkStreamReport] Failed", e);
        return "0x";
    }
  }

  /**
   * Reserved: Build Redstone payload
   * @param {object} redstoneGroup
   * @returns {Promise<string>} redstonePayload
   */
  async function buildRedstonePayload(redstoneGroup) {
    // redstoneGroup.feedSymbols: symbol array after parseBytes32String
    // redstoneGroup.feedIds: original bytes32 feedID array
    // redstoneGroup.extractor: redstoneExtractor() address
    // Import DataServiceWrapper to generate real payload
    if (!redstoneGroup || !Array.isArray(redstoneGroup.feedSymbols) || redstoneGroup.feedSymbols.length === 0) {
      console.warn("[buildPriceProviderVerificationPayload] Redstone group has no symbols, returning empty 0x");
      return "0x";
    }

    const extractorAddress = redstoneGroup.extractor;
    if (!extractorAddress || !/^0x[a-fA-F0-9]{40}$/.test(extractorAddress)) {
      console.warn("[buildPriceProviderVerificationPayload] Missing valid extractor address, returning 0x");
      return "0x";
    }

    // Filter symbols
    const redstoneSymbols = redstoneGroup.feedSymbols
      .map(s => (s || "").trim())
      .filter(s => s && s !== "UNKNOWN");

    if (redstoneSymbols.length === 0) {
      console.warn("[buildPriceProviderVerificationPayload] All symbols are UNKNOWN, returning 0x");
      return "0x";
    }

    // Prioritize existing global, then try dynamic loading
    let DataServiceWrapper = window.RedstoneConnector.DataServiceWrapper;
    // TODO: This doesn't work
    // Source: https://www.jsdelivr.com/package/npm/@redstone-finance/evm-connector?tab=files&path=dist
    //
    // https://cdn.jsdelivr.net/npm/@redstone-finance/evm-connector@0.9.0/dist/src/helpers/add-contract-wait.min.js
    // Error: exports is not defined
    // https://cdn.jsdelivr.net/npm/@redstone-finance/evm-connector@0.9.0/+esm
    // Error: Cannot read properties of null (reading 'AbiCoder')

    // provider
    let provider;
    try {
      provider = window.stapleCommon.getRpcProvider();
    } catch (e) {
      console.warn("[buildPriceProviderVerificationPayload] Failed to get provider, returning 0x", e);
      throw e;
    }

    const extractor = new ethers.Contract(extractorAddress, stapleRedstoneExtractorAbi, provider);

    const authorizedSigners = [
      // Single signer example, can be extended/parameterized as needed
      "0x0C39486f770B26F5527BBBf942726537986Cd7eb"
    ];

    let redstonePayload = "0x";
    try {
      const wrapper = new DataServiceWrapper({
        uniqueSignersCount: 1,
        dataPackagesIds: redstoneSymbols,
        authorizedSigners
      });
      redstonePayload = await wrapper.getRedstonePayloadForManualUsage(extractor);
      if (typeof redstonePayload !== "string" || !redstonePayload.startsWith("0x")) {
        console.warn("[buildPriceProviderVerificationPayload] Generated payload is not valid hex, fallback to 0x");
        redstonePayload = "0x";
      }
    } catch (e) {
      console.warn("[buildPriceProviderVerificationPayload] Failed to generate Redstone payload, returning 0x", e);
      redstonePayload = "0x";
    }

    return redstonePayload;
  }

  async function setTokenBalance(tokenAddress, userAddress, amount, provider) {
    const amountHex = ethers.utils.hexZeroPad(amount.toHexString(), 32);
    
    const setStorage = async (addr, slot, val) => {
        try {
            await provider.send("hardhat_setStorageAt", [addr, slot, val]);
            return true;
        } catch (e) {
            try {
                await provider.send("anvil_setStorageAt", [addr, slot, val]);
                return true;
            } catch (e2) {
                return false;
            }
        }
    };

    const contract = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);

    for (let i = 0; i < 50; i++) {
        const slotIndex = ethers.utils.hexZeroPad(ethers.utils.hexlify(i), 32);
        const key = ethers.utils.hexZeroPad(userAddress, 32);
        const probeSlot = ethers.utils.keccak256(ethers.utils.concat([key, slotIndex]));
        
        const prevVal = await provider.getStorageAt(tokenAddress, probeSlot);
        
        const success = await setStorage(tokenAddress, probeSlot, amountHex);
        if (!success) {
            console.warn("[setTokenBalance] RPC methods for setStorageAt not supported");
            return;
        }
        
        const newBal = await contract.balanceOf(userAddress);
        if (newBal.eq(amount)) {
            console.log(`[setTokenBalance] Success at slot index ${i}`);
            return;
        }
        
        // Revert
        await setStorage(tokenAddress, probeSlot, prevVal);
    }
    console.warn("[setTokenBalance] Failed to find balance slot");
  }

  async function ensureLinkBalance(targetAddress) {
    const provider = window.stapleCommon.getRpcProvider();
    const { chainId } = await provider.getNetwork();
    const LINK_ADDRESS = "0xb1D4538B4571d411F07960EF2838Ce337FE1E80E";
    
    if (!targetAddress || !ethers.utils.isAddress(targetAddress)) {
        console.warn("[ensureLinkBalance] Invalid target address");
        return;
    }

    // Check balance
    const linkContract = new ethers.Contract(LINK_ADDRESS, [
        "function balanceOf(address) view returns (uint256)"
    ], provider);
    
    const balance = await linkContract.balanceOf(targetAddress);
    console.log(`[ensureLinkBalance] Target ${targetAddress} LINK balance: ${ethers.utils.formatEther(balance)}`);
    
    if (chainId === 421614) {
        if (balance.eq(0)) {
            console.log("[ensureLinkBalance] Setting LINK balance via RPC...");
            try {
                await setTokenBalance(LINK_ADDRESS, targetAddress, ethers.utils.parseEther("100"), provider);
                
                const newBal = await linkContract.balanceOf(targetAddress);
                if (newBal.gt(0)) {
                     console.log("[ensureLinkBalance] Successfully set LINK balance");
                } else {
                     console.warn("[ensureLinkBalance] Failed to set LINK balance via RPC");
                }
            } catch (e) {
                console.warn("[ensureLinkBalance] RPC setBalance failed", e);
            }
        }
    } else {
        if (balance.eq(0)) {
            console.warn(`[ensureLinkBalance] Target ${targetAddress} has 0 LINK. Verification might fail.`);
        }
    }
  }

  /**
   * Main function: Build verification payload
   * @param {string[]} tokenAddresses
   * @returns {Promise<{encoded:string,payload:Array,groups:Object}>}
   */
  async function buildPriceProviderVerificationPayload(tokenAddresses) {
    if (!Array.isArray(tokenAddresses)) throw new Error("tokenAddresses must be an array");
    const cleaned = tokenAddresses
      .map(a => (a || "").trim())
      .filter(a => /^0x[a-fA-F0-9]{40}$/.test(a) && a !== zeroAddress);

    if (cleaned.length === 0) {
      return { encoded: ethers.utils.defaultAbiCoder.encode(["tuple(address,address[],address[],bytes)[]"], [[]]), payload: [], groups: {} };
    }

    console.log("[buildPriceProviderVerificationPayload] Input tokens:", tokenAddresses);
    console.log("[buildPriceProviderVerificationPayload] Cleaned tokens:", cleaned);

    // Modify: Unified get provider and priceProvider from wrapper
    const priceProvider = await window.contracts.getPriceProvider();

    const groups = {
      STAPLE_v1: { verifier: null, tokens: [] },
      CHAINLINK_DATA_FEED_v1: { verifier: null, tokens: [] },
      CHAINLINK_STREAM_v1: { verifier: null, tokens: [], reports: [] },
      REDSTONE_v1: { verifier: null, tokens: [], feedIds: [], feedSymbols: [], extractor: null }
    };

    // Batch 1: getVerifierSingle
    const verifierCalls = cleaned.map(token => ({
        target: priceProvider.address,
        abi: ['function getVerifierSingle(address) view returns (address)'],
        method: 'getVerifierSingle',
        params: [token]
    }));
    const verifierResults = await window.RpcManager.multicall(verifierCalls);
    console.log("[buildPriceProviderVerificationPayload] verifierResults:", verifierResults);
    
    const tokenVerifiers = {};
    const uniqueVerifiers = new Set();
    cleaned.forEach((token, i) => {
        const v = verifierResults[i];
        if (v && v !== zeroAddress) {
            tokenVerifiers[token] = v;
            uniqueVerifiers.add(v);
        }
    });

    // Batch 2: oracleType
    const verifierList = Array.from(uniqueVerifiers);
    const oracleTypeCalls = verifierList.map(v => ({
        target: v,
        abi: ['function oracleType() view returns (string)'],
        method: 'oracleType',
        params: []
    }));
    const oracleTypeResults = await window.RpcManager.multicall(oracleTypeCalls);
    console.log("[buildPriceProviderVerificationPayload] oracleTypeResults:", oracleTypeResults);
    const verifierOracleTypes = {};
    verifierList.forEach((v, i) => {
        verifierOracleTypes[v] = oracleTypeResults[i];
    });

    // Process tokens
    for (const token of cleaned) {
        const verifierAddress = tokenVerifiers[token];
        if (!verifierAddress) {
            console.warn(`[buildPriceProviderVerificationPayload] No verifier found for token ${token}`);
            continue;
        }

        const oType = verifierOracleTypes[verifierAddress];
        console.log(`[buildPriceProviderVerificationPayload] Token ${token} -> Verifier ${verifierAddress} -> OracleType ${oType}`);

        if (!oType) {
            console.warn(`[buildPriceProviderVerificationPayload] No oracleType found for verifier ${verifierAddress}`);
            continue;
        }

        // redstone not working
        if (oType === "REDSTONE_v1") {
            console.log(`[buildPriceProviderVerificationPayload] Skipping REDSTONE_v1 for token ${token}`);
            continue;
        }

        if (!groups[oType]) {
            console.warn(`Found unrecognized oracleType=${oType}, token=${token}, ignoring`);
            continue;
        }

        const g = groups[oType];
        if (g.verifier && g.verifier.toLowerCase() !== verifierAddress.toLowerCase()) {
            console.warn(`Same oracleType(${oType}) found different verifier: ${g.verifier} vs ${verifierAddress}`);
        }
        if (!g.verifier) g.verifier = verifierAddress;
        g.tokens.push(token);

        // Special handling
        if (oType === "CHAINLINK_STREAM_v1") {
            const verifierContract = await window.contracts.getVerifier(verifierAddress);
            try {
                await ensureLinkBalance(verifierAddress);
            } catch (e) {
                console.warn("[buildPriceProviderVerificationPayload] ensureLinkBalance failed", e);
            }
            g.reports.push(await fetchChainlinkStreamReport(token, verifierContract));
        }
    }

    console.log("[buildPriceProviderVerificationPayload] Final groups:", groups);

    const payloadToEncode = [];

    function pushGroup(g) {
      if (!g || !g.tokens || g.tokens.length === 0) return;
      if (!g.verifier) {
        console.warn("Group missing verifier, skipping: ", g);
        return;
      }
      const zeros = new Array(g.tokens.length).fill(zeroAddress);
      payloadToEncode.push([g.verifier, g.tokens, zeros, "0x"]);
    }

    // STAPLE_v1
    pushGroup(groups.STAPLE_v1);

    // CHAINLINK_DATA_FEED_v1
    pushGroup(groups.CHAINLINK_DATA_FEED_v1);

    // CHAINLINK_STREAM_v1
    if (groups.CHAINLINK_STREAM_v1.tokens.length > 0) {
      const g = groups.CHAINLINK_STREAM_v1;
      const zeros = new Array(g.tokens.length).fill(zeroAddress);
      // encode bytes[] -> bytes
      const encodedReports = ethers.utils.defaultAbiCoder.encode(["bytes[]"], [g.reports]);
      payloadToEncode.push([g.verifier, g.tokens, zeros, encodedReports]);
    }

    // REDSTONE_v1
    if (groups.REDSTONE_v1.tokens.length > 0) {
      const g = groups.REDSTONE_v1;
      const zeros = new Array(g.tokens.length).fill(zeroAddress);
      const redstonePayload = await buildRedstonePayload(g);
      payloadToEncode.push([g.verifier, g.tokens, zeros, redstonePayload]);
    }

    const encoded = ethers.utils.defaultAbiCoder.encode(
      ["tuple(address,address[],address[],bytes)[]"],
      [payloadToEncode]
    );

    console.log("[buildPriceProviderVerificationPayload] payload build complete", { encoded, payload: payloadToEncode, groups });
    return encoded;
  }

  // Expose to global
  window.buildPriceProviderVerificationPayload = buildPriceProviderVerificationPayload;
})();
