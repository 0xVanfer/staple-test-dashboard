# Staple Dashboard Overview & User Manual

This page provides a complete guide for using the Staple Test Dashboard.

## Quick Navigation

-   [Environment](#environment)
-   [Test Tokens](#test-tokens)
-   [Pools & Vtps](#pools--vtps)
-   [Swap](#swap)
-   [Calculator](#calculator)
-   [Errors](#errors)

## Environment

### Overview

Configure the on-chain environment and user accounts for reuse across all interaction pages (persisted locally).

-   **Required:** Every user must add and select at least one `user` address as the account (signer) for subsequent contract calls.
-   **Configurable:** uiPoolDataProvider, router, testERC20Factory, poolImpl, contractDeployer, stapleVerifier, rpc, chainID.
-   **Read-only Derived:** controller, incentivesController, priceProvider (automatically derived from configurable addresses).

### Quick Start

1. Set RPC and Chain ID (ensure the node is readable and writable).
2. Set the uiPoolDataProvider address, check if read-only items like controller are automatically displayed.
3. Set other contract addresses as needed.
4. Add a user address and select it from the dropdown.

[Open Environment Page](./src/pages/environment/index.html)

## Test Tokens

### Functionality

Quickly prepare assets and price data needed for the test environment.

-   **Step 1:** **Mint ETH** for the user address (only valid for local test nodes). **(Required)**
-   **Step 2:** Batch **Mint Test Tokens** (USDC, USDT, DAI, WETH, etc.). **(Required)**
-   **Step 3:** If using STAPLE_v1 price mode, update prices and click Verify.

> ⚠️ Important: You must mint ETH first, then mint Test Tokens, otherwise transactions will fail.

[Open Test Tokens Page](./src/pages/testtoken/index.html)

## Pools & Vtps

### Core Functionality

A one-stop management page integrating all pools, vtps, and positions features. **This is the main interaction page.**

### Page Layout

-   **Left Filter Panel:** Browse by pool, supports search and filtering.
-   **Details Area:** Displays basic info, asset status, and user data for the selected pool.
-   **Related VTP Area:** Displays all VTPs under the pool; view parameters, set rates, and manage incentives for each VTP.
-   **Action Area:** Perform operations like Deposit, Withdraw, Adjust Position.

### Main Operations

-   **Deposit:** Deposit assets into the pool to receive LP tokens.
-   **Withdraw:** Redeem LP tokens to withdraw assets.
-   **Adjust Position:** Adjust allocation quotas for each VTP.
    -   Set target allocation in VTP blocks.
    -   Optionally deposit additional assets.
    -   System automatically calculates fees and executes rebalancing.
-   **VTP Parameter Management:** Update swap fees, max allocate rate, ALR lower bound.
-   **Incentive Management:** Create and manage reward incentives for VTPs.

> 💡 Tip: The Pools & Vtps page integrates all features from the original Pool Details, VTP Details, and User Position pages.

[Open Pools & Vtps Page](./src/pages/pools-vtps/index.html)

## Swap

### Functionality

Execute token swaps within the VTP network, automatically finding the optimal path.

-   **Smart Routing:** Automatically enumerates swap paths up to 4 hops, selecting the one with the highest output.
-   **Fee Estimation:** Real-time display of fees and expected output for each hop.
-   **Slippage Protection:** Set maximum slippage to protect transaction safety.
-   **Price Verification:** Automatically constructs and submits price verification payloads.

### Usage Flow

1. Select the token to sell and the amount.
2. Select the token to buy.
3. System automatically calculates the optimal path and expected output.
4. Set slippage tolerance (recommended 0.5% - 2%).
5. Click Swap to execute the transaction.

[Open Swap Page](./src/pages/swap/index.html)

## Calculator

### Available Tools

-   **APR Calculator:** Calculate the optimal VTP combination to maximize APR.
    -   Input max allocate rate, credit, and APR for each VTP.
    -   System automatically enumerates all combinations to find the optimal solution.
    -   Displays allocation ratio and contribution for each VTP.
-   **Swap Calculator:** Offline swap simulation calculator, no contract interaction required.
    -   Select VTP and swap direction.
    -   Edit all parameters (n, p, assets, liabilities, fees, etc.).
    -   View detailed calculation steps: PAV, fees, punishment, final output.
    -   Suitable for teaching, debugging, and parameter optimization.

[Open Calculator Page](./src/pages/calc/index.html)

## Errors

### Functionality

Quickly query error messages corresponding to contract error signatures to help debug and understand reasons for contract execution failures.

-   **Exact Query:** Input complete error signature (e.g., 0x2d5fb10f) to get detailed info.
-   **Fuzzy Search:** Supports partial signature matching, returns all relevant errors.
-   **Flexible Input:** Automatically handles signatures with/without 0x prefix.
-   **Browse All:** Expand to view the list of all available errors.

### Usage Scenarios

-   Extract signature from error info when a transaction fails and query the reason.
-   Quickly understand the meaning of specific errors during development and debugging.
-   Browse all error definitions to understand the contract's error handling mechanism.

> 💡 Tip: Error signature is the unique identifier for Solidity errors, consisting of the first 4 bytes of the keccak256 hash of the error name and parameter types.

[Open Errors Page](./src/pages/errors/index.html)
