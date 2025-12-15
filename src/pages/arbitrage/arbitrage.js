// arbitrage.js

/**
 * Main Entry Point for Arbitrage Page
 * 
 * This script acts as the controller that bootstraps the application.
 * It:
 * 1. Waits for the DOM to be fully loaded.
 * 2. Instantiates the UI handler (ArbitrageUI).
 * 3. Instantiates the Service handler (ArbitrageService).
 * 4. Binds all UI events (clicks, changes, inputs) to Service methods.
 * 5. Initializes the Service to load initial data.
 */
// Dependencies: src/lib/common.js, src/lib/contractCalls.js, src/pages/environment/environment.js, src/pages/arbitrage/arbitrage-ui.js, src/pages/arbitrage/arbitrage-service.js
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[Arbitrage] DOMContentLoaded");

    // Wait for environment to be ready
    await new Promise(resolve => {
        const check = setInterval(() => {
            if (window.environment && window.contractData && window.swapGraph) {
                clearInterval(check);
                resolve();
            }
        }, 100);
    });
    
    // Initialize core components
    const ui = new ArbitrageUI();
    const service = new ArbitrageService(ui);

    // --- Navigation Handling ---
    // Sets up tab switching logic (Mock Curve <-> UniV2 <-> UniV3 <-> Internal)
    ui.setupNavigation((target) => {
        console.log("[Arbitrage] Tab changed to:", target);
        service.currentTab = target;
        // Update the configuration panel to show the state of the selected DEX
        service.updateConfigPanel();
        // Recalculate arbitrage opportunity for the new DEX
        service.calculateExternalArbitrage();
    });

    // --- Event Listeners: Token Selection ---
    
    // Handle Token A selection change
    ui.els.tokenASelect.addEventListener('change', (e) => {
        console.log("[Arbitrage] Token A changed:", e.target.value);
        service.tokenA = e.target.value;
        service.updateLabels(); // Update UI labels (e.g., "Balance ETH")
        service.updateConfigPanel(); // Fetch new pool state for this token pair
        service.calculateExternalArbitrage(); // Recalculate
    });

    // Handle Token B selection change
    ui.els.tokenBSelect.addEventListener('change', (e) => {
        console.log("[Arbitrage] Token B changed:", e.target.value);
        service.tokenB = e.target.value;
        service.updateLabels();
        service.updateConfigPanel();
        service.calculateExternalArbitrage();
    });

    // Handle Swap Tokens button click (A <-> B)
    ui.els.swapBtn.addEventListener('click', () => {
        console.log("[Arbitrage] Swapping tokens");
        const temp = service.tokenA;
        service.tokenA = service.tokenB;
        service.tokenB = temp;
        
        // Update dropdowns to reflect swap
        ui.els.tokenASelect.value = service.tokenA;
        ui.els.tokenBSelect.value = service.tokenB;
        
        service.updateLabels();
        service.updateConfigPanel();
        service.calculateExternalArbitrage();
    });

    // --- Event Listeners: Input & Execution ---

    // Debounce the calculation when typing in the amount field to avoid spamming
    const debouncedCalc = Utils.debounce(() => service.calculateExternalArbitrage(), 500);
    ui.els.amountIn.addEventListener('input', (e) => {
        // console.log("[Arbitrage] Amount input changed"); // Too verbose
        debouncedCalc();
    });

    // Handle Execute Arbitrage button click
    ui.els.executeBtn.addEventListener('click', () => {
        console.log("[Arbitrage] Execute button clicked");
        service.executeArbitrage();
    });

    // --- Event Listeners: Internal Arbitrage ---
    
    ui.els.internalBtn.addEventListener('click', () => {
        console.log("[Arbitrage] Internal calc button clicked");
        service.calculateInternalArbitrage();
    });

    if (ui.els.internalExecuteBtn) {
        ui.els.internalExecuteBtn.addEventListener('click', () => {
            console.log("[Arbitrage] Internal execute button clicked");
            service.executeInternalArbitrage();
        });
    }

    // --- Event Listeners: Mock DEX Configuration Updates ---

    // Update Mock Curve Pool
    ui.els.curveForm.btn.addEventListener('click', () => {
        console.log("[Arbitrage] Update Curve button clicked");
        service.updateCurvePool();
    });
    
    // Update Mock Uniswap V2 Pair
    ui.els.univ2Form.btn.addEventListener('click', () => {
        console.log("[Arbitrage] Update UniV2 button clicked");
        service.updateUniV2Pair();
    });
    
    // Update Mock Uniswap V3 Pool
    ui.els.univ3Form.btn.addEventListener('click', () => {
        console.log("[Arbitrage] Update UniV3 button clicked");
        service.updateUniV3Pool();
    });
    
    // Add new liquidity pillar row for Uniswap V3
    if (ui.els.univ3Form.addPillarBtn) {
        ui.els.univ3Form.addPillarBtn.addEventListener('click', () => ui.addUniV3PillarRow());
    }

    // --- Initialization ---
    console.log("[Arbitrage] Initializing Service...");
    await service.init();
    console.log("[Arbitrage] Initialization Complete");
});
