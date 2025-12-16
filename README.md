# Staple Dashboard User Guide

This guide provides detailed instructions for all features and usage of the Staple Dashboard. The Dashboard is a static multi-page application for managing the Staple Protocol's test environment, tokens, liquidity pools, and more.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment](#environment)
3. [Test Tokens](#test-tokens)
4. [Pools & VTPs](#pools--vtps)
5. [Swap](#swap)
6. [Calculator](#calculator)
7. [Arbitrage](#arbitrage)
8. [Errors](#errors)

---

## Quick Start

### Initial Setup Workflow

1. **Configure Environment** → Visit the Environment page to set RPC, contract addresses, and user accounts
2. **Get Test Tokens** → Visit the Test Tokens page to mint ETH and test tokens
3. **Manage Liquidity Pools** → Visit the Pools & VTPs page to create/manage pools and positions
4. **Execute Trades** → Use the Swap page to execute token swaps

### How to Access

Open \`index.html\` directly in your browser or start the project using a static server.

---

## Environment

The Environment page is the core configuration center for the entire Dashboard. All other pages depend on the settings configured here.

### Sidebar Navigation

The left sidebar has five tabs:

-   👤 **User Settings** - User account management
-   🌐 **Network Settings** - Network and RPC configuration
-   📋 **Contract Addresses** - Contract address configuration
-   🏊 **Pool Info** - Pool information cache
-   🔣 **Symbols** - Token symbol cache

---

### 👤 User Settings

Manage user accounts for contract interactions.

#### User List

Displays all added users, including:

-   Nickname (if set)
-   Wallet address
-   Whether a private key is configured

#### Add New User

| Field       | Description                            | Required                              |
| ----------- | -------------------------------------- | ------------------------------------- |
| Address     | User wallet address (0x...)            | Yes (if private key not provided)     |
| Private Key | Private key (for signing transactions) | No (address auto-derived if provided) |
| Nickname    | User nickname (for identification)     | No                                    |

**Action Buttons:**

-   **Add User** - Add user to the list
-   **🎲 Random** - Generate a random wallet with one click (auto-fills address, private key, and sets nickname to "Random User 0xXXXX")

> 💡 **Tip**: If only a private key is provided, the system will automatically calculate the corresponding address. Production environments prohibit simulated signing and require a private key.

#### Clear User Cache

Clear locally cached user data.

---

### 🌐 Network Settings

Configure blockchain network connection parameters.

#### Network Selection

-   **Network Select** - Dropdown to select saved network configurations
-   **New Network** - Create a new network configuration

#### General Configuration

| Field            | Description                                           | Editable |
| ---------------- | ----------------------------------------------------- | -------- |
| Environment Type | Whether production (checked = production environment) | ✅       |
| RPC Endpoint     | Blockchain RPC node URL                               | ✅       |
| Chain ID         | Chain ID (read-only, auto-fetched from RPC)           | ❌       |

> ⚠️ **Note**: After changing the RPC, the system will automatically re-derive Controller, IncentivesController, and PriceProvider addresses.

#### Deployer Configuration

| Field                     | Description                   | Editable |
| ------------------------- | ----------------------------- | -------- |
| Deployer Private Key      | Contract deployer private key | ✅       |
| Contract Deployer Address | Deployer address              | ✅       |

#### Chainlink Stream API

For Chainlink oracle integration:

| Field             | Description                 |
| ----------------- | --------------------------- |
| Stream API Key    | Chainlink Stream API Key    |
| Stream API Secret | Chainlink Stream API Secret |

---

### 📋 Contract Addresses

Configure contract addresses for the Staple Protocol.

#### Core Contracts

| Contract              | Description                    | Editable |
| --------------------- | ------------------------------ | -------- |
| UI Pool Data Provider | Contract for pool data queries | ✅       |
| Pool Implementation   | Pool implementation contract   | ✅       |
| Router                | Router contract (for Swap)     | ✅       |
| Test ERC20 Factory    | Test token factory contract    | ✅       |

#### Verifiers

| Contract                    | Description                    |
| --------------------------- | ------------------------------ |
| Staple Verifier             | Staple internal verifier       |
| Chainlink DataFeed Verifier | Chainlink data feed verifier   |
| Chainlink Stream Verifier   | Chainlink stream data verifier |

#### Mock DEX Configuration

For testing arbitrage functionality:

| Contract            | Description                 |
| ------------------- | --------------------------- |
| Mock DEX Aggregator | Mock DEX aggregator         |
| Mock Curve          | Mock Curve pool (read-only) |
| Mock Uniswap V3     | Mock Uniswap V3 (read-only) |

#### Derived Addresses (Read-only)

These addresses are automatically read from the uiPoolDataProvider contract:

-   **Controller** - Protocol controller
-   **Incentives Controller** - Incentives controller
-   **Price Provider** - Price provider

**Button Functions:**

-   **Reload Contracts** - Reload derived addresses from the chain
-   **Clear Contracts Cache** - Clear contract address cache

---

### 🏊 Pool Info

View and manage pool data cache status.

#### Cache Status

| Info         | Description                                |
| ------------ | ------------------------------------------ |
| Last Updated | Last cache update time                     |
| TTL          | Cache validity period (default 10 minutes) |
| Expires In   | Time until expiration                      |
| Pool Length  | Number of cached pools                     |
| VTP Length   | Number of cached VTPs                      |

#### Raw Data Preview

Displays a preview of the cached raw JSON data.

**Button Functions:**

-   **Force Refresh** - Force refresh pool data cache

---

### 🔣 Symbols

Manage token symbol cache.

#### Cache Status

| Info          | Description                              |
| ------------- | ---------------------------------------- |
| Last Updated  | Last cache update time                   |
| TTL           | Cache validity period (default 24 hours) |
| Expires In    | Time until expiration                    |
| Total Symbols | Number of cached symbols                 |

#### Cached Symbols

Displays all cached token address to symbol mappings.

**Button Functions:**

-   **Force Refresh** - Force refresh symbol cache

---

## Test Tokens

For minting ETH and test tokens in test/development environments.

### Quick Action Cards

#### 💰 ETH Balance

-   Displays current user's ETH balance
-   **Mint ETH** - Mint ETH for the current user (via Hardhat/Anvil JSON-RPC setBalance)

#### 🪙 Batch Operations

-   **Mint All Tokens** - Batch mint all configured tokens (10,000,000 each)
-   **Refresh Balances** - Refresh all token balance displays

#### ✅ Price Verification

-   **Verify All Prices** - Verify that prices for all STAPLE mode tokens are correctly set

#### ➕ Create New Token

Click to open the create token dialog.

---

### Token List

Table displaying all configured test tokens:

| Column      | Description          |
| ----------- | -------------------- |
| Symbol      | Token symbol         |
| Address     | Contract address     |
| Balance     | Current user balance |
| Price (USD) | Current price (USD)  |
| Oracle Type | Oracle type          |
| Actions     | Action buttons       |

Actions for each token row:

-   **Mint** - Mint this token (amount: 10,000,000)
-   **Update Price** - Update price (STAPLE mode only)

---

### Create New Token Dialog

#### Use Existing Token Address

If associating an already deployed token, enter its address (leave empty to deploy a new token).

#### New Token Parameters

| Field        | Description                       |
| ------------ | --------------------------------- |
| Token Symbol | Token symbol (e.g., USDT)         |
| Decimals     | Decimal places (1-18, default 18) |
| Oracle Type  | Oracle type                       |

#### Oracle Type Options

| Type                | Description               | Additional Config                    |
| ------------------- | ------------------------- | ------------------------------------ |
| NOT_DECIDED         | Not decided               | None                                 |
| STAPLE              | Use Staple internal price | Requires Initial Price               |
| CHAINLINK_DATA_FEED | Use Chainlink data source | Requires Chainlink Data Feed address |

---

### Usage Workflow

1. Set up user address on the Environment page
2. Click **Mint ETH** to get ETH (for paying gas)
3. Click **Mint All Tokens** to batch get all test tokens
4. If using STAPLE mode tokens, update prices first, then click **Verify All Prices** to verify

---

## Pools & VTPs

The core page for managing liquidity pools, VTPs (Virtual Token Pairs), and positions.

### Page Layout

-   **Left Panel** - Pool/VTP list and filtering
-   **Detail Area** - Details of selected item
-   **Related Items Area** - Associated VTPs or VtpTokens
-   **Actions Area** - Available operations

---

### Left Panel Functions

#### Action Buttons

-   **Refresh** - Refresh pool data
-   **Create Pool** - Create a new pool
-   **Create VTP** - Create a new VTP
-   **Modify Risk** - Modify risk parameters

#### Search

Input box supports searching pools/VTPs by symbol or ID.

#### List

Displays all pools and VTPs. Click to select and view details on the right.

---

### Create Pool

Create a new liquidity pool with the following parameters:

| Parameter    | Description             |
| ------------ | ----------------------- |
| Pool ID      | Unique pool identifier  |
| Other params | As required by contract |

---

### Create VTP

Create a Virtual Token Pair with the following parameters:

| Parameter    | Description        |
| ------------ | ------------------ |
| Pool         | Associated pool    |
| Token A      | Token A address    |
| Token B      | Token B address    |
| Other params | Fees, limits, etc. |

---

### Detail Area

Displays details of the selected pool or VTP:

**Pool Details:**

-   Pool ID
-   Status (Active/Paused)
-   Creation time
-   Configuration parameters

**VTP Details:**

-   VTP ID
-   Associated Pool
-   Token Pair
-   Current status
-   Fee configuration
-   ALR bounds, etc.

---

### Related Items Area

-   When **Pool** is selected: Shows all VTPs under that pool
-   When **VTP** is selected: Shows VtpToken info (assets, liabilities, etc.)

---

### Actions Area

Shows different operations based on selected item type:

#### Pool-level Operations

| Operation        | Description                |
| ---------------- | -------------------------- |
| Update Risk Info | Update risk parameters     |
| Update Fees      | Update fee configuration   |
| Update Max Alloc | Update max allocation rate |
| Update ALR Bound | Update ALR bounds          |
| Pause            | Pause the pool             |
| Unpause          | Resume the pool            |

#### VTP-level Operations

| Operation        | Description                |
| ---------------- | -------------------------- |
| Deposit          | Deposit liquidity          |
| Withdraw         | Withdraw liquidity         |
| Adjust Position  | Adjust position allocation |
| Create Incentive | Create incentive           |

---

### Example Operation: Deposit

1. Select the target VTP from the left list
2. The Actions area will display the Deposit form
3. Enter the deposit amount
4. Click the **Deposit** button
5. Wait for transaction confirmation (button shows "Sending Tx..." → "Confirming...")

---

## Swap

Execute token swaps with multi-hop routing and slippage protection.

### Interface Layout

-   **Left Side** - Swap input interface
-   **Right Side** - Route display area

---

### Swap Input

#### From (Sell Token)

-   Shows balance
-   Enter swap amount
-   Dropdown to select token

#### To (Buy Token)

-   Shows balance
-   Auto-calculated expected output
-   Dropdown to select token

#### Direction Switch

Click the ↕ button in the middle to quickly swap From and To tokens.

#### Slippage Settings

Click the ⚙️ button in the top right to expand:

-   **0.3%** / **0.5%** / **1%** - Quick selection
-   **Custom** - Custom slippage percentage

---

### Route Display

#### 🏆 Best Route

Displays the optimal swap path calculated by the system, including:

-   Path nodes (token symbols)
-   Expected output amount

#### 📊 Valuation Details

Expand to view detailed path estimates:

-   Input/output for each hop
-   Fees
-   Price impact

#### 🛣️ All Routes

Expand to view all available swap paths, sorted by output amount.

---

### Execute Swap

1. Select From and To tokens
2. Enter swap amount
3. System automatically calculates the best route
4. Check expected output and route
5. Click the **Swap** button
6. Button status changes: \`Swap\` → \`Sending Tx...\` → \`Confirming...\` → \`Swap\`
7. Balance automatically updates after transaction completes

> 💡 **Tip**: Supports up to 3 hops. The system automatically selects the path with optimal output.

---

## Calculator

Provides offline calculation tools without on-chain interaction.

### Tab Navigation

-   **APR Calculator** - APR calculator
-   **Fee Calculator** - Fee calculator

---

### APR Calculator

Calculate optimal VTP combinations for maximum APR.

#### Parameters

| Parameter     | Description             |
| ------------- | ----------------------- |
| Decimals      | Display decimal places  |
| Total Credits | Available total credits |

#### VTP Entries

For each VTP to calculate:

-   **Max Allocate (%)** - Maximum allocation percentage
-   **Credit** - Required credit amount
-   **APR Max (%)** - Maximum APR

Click **+ Add** to add new entries.

#### Calculation Results

After clicking **Calculate**:

-   **Best APR** - Total APR of optimal combination
-   **Results Table** - Allocation rate and APR contribution for each VTP

#### Algorithm Explanation

Expand **📖 Algorithm Explanation** for detailed algorithm:

1. Generate all possible VTP combinations
2. Filter combinations that satisfy credit constraints
3. Calculate combined APR for each combination
4. Return optimal solution

---

### Fee Calculator

Simulate fee calculations for Swap/Allocate/Deallocate operations.

#### Configuration Parameters

| Parameter      | Description                                  |
| -------------- | -------------------------------------------- |
| Operation Type | Operation type: Swap / Allocate / Deallocate |
| Select VTP     | Select target VTP                            |
| Direction      | Swap direction                               |
| Amount         | Operation amount                             |

#### VTP Parameters

Can be manually adjusted for hypothetical analysis:

-   **n / p** - Pool parameters
-   **Po / Pa** - Oracle price / Adjusted price
-   **From/To Token** params: Assets, Liability, Swap Fee In/Out, Protocol Fee Rate, ALR Bound

#### Calculation Results

Displays detailed step-by-step calculation process, including:

-   Specific amounts for each fee
-   Final output amount
-   Fee breakdown

---

## Arbitrage

Test external DEX and internal arbitrage opportunities.

### Left Navigation

#### External Arbitrage

-   **Mock Curve** - Mock Curve pool configuration
-   **Mock Uniswap V2** - Mock V2 pair configuration
-   **Mock Uniswap V3** - Mock V3 pool configuration
-   **Aggregator** - Aggregator description

#### Internal Arbitrage

-   **Internal** - Protocol internal cyclic arbitrage

---

### Mock Curve Configuration

#### Current State

Displays current Mock Curve pool configuration:

-   Balance A / B (token balances)
-   Amplification (A)
-   Fee

#### Update Configuration

| Parameter         | Description                                |
| ----------------- | ------------------------------------------ |
| Balance A         | Token A balance                            |
| Balance B         | Token B balance                            |
| Amplification (A) | Amplification factor (affects price curve) |
| Fee (%)           | Fee percentage                             |

Click **Update Curve Pool** to submit update.

---

### Mock Uniswap V2 Configuration

#### Current State

-   Reserve A / B (reserves)
-   Fee Rate

#### Update Configuration

| Parameter    | Description      |
| ------------ | ---------------- |
| Reserve A    | Token A reserve  |
| Reserve B    | Token B reserve  |
| Fee Rate (%) | Trading fee rate |

Click **Update V2 Pair** to submit update.

---

### Mock Uniswap V3 Configuration

#### Current State

-   Fee
-   Liquidity Distribution (chart)

#### Update Configuration

| Parameter         | Description               |
| ----------------- | ------------------------- |
| Fee (%)           | Fee                       |
| Liquidity Pillars | Liquidity pillar settings |

**Liquidity Pillars**

For each pillar:

-   **Price** - Price point (must be decreasing)
-   **Amt A** - Token A amount at this price point
-   **Amt B** - Token B amount at this price point

Click **+ Add Pillar** to add pillars, click **Update V3 Pool** to submit.

---

### Internal Arbitrage

Find cyclic arbitrage opportunities within the protocol (e.g., A → B → C → A).

#### Configuration

| Parameter       | Description                           |
| --------------- | ------------------------------------- |
| Arbitrage Asset | Arbitrage asset (start and end token) |
| Amount In       | Input amount                          |

#### Workflow

1. Select arbitrage asset
2. Enter amount
3. Click **Check Opportunities**
4. View results:
    - **Best Path** - Optimal path
    - **Amount Out** - Output amount
    - **Profit** - Profit
5. If profitable, click **Execute Internal Arbitrage** to execute

---

### External Arbitrage Results

Displays when executing external arbitrage:

-   **Staple (A → B)** - Staple protocol swap output
-   **External (B → A)** - External DEX swap output
-   **Profit** - Profit (Token A)
-   **Profit Ratio (bps)** - Profit ratio (basis points)

---

### Right Panel: External Arbitrage Execution

Quick external arbitrage execution:

1. Select **Token A (In)** and amount
2. Select **Token B (Out)**
3. View estimated output
4. Click **Execute Arbitrage**

#### Global Settings

-   **Update External DEX State** - When checked, arbitrage execution will also update external DEX state

---

## Errors

Decode contract error signatures for debugging failed transactions.

### Search Function

#### Search Error Signature

Enter error signature to query:

-   Supports \`0x\` prefix: \`0x2d5fb10f\`
-   Supports without prefix: \`2d5fb10f\`
-   Supports fuzzy matching

#### Action Buttons

-   **Search** - Execute search
-   **Clear** - Clear input

---

### Search Results

Matched errors display:

-   Error signature
-   Error name
-   Error description (if available)

---

### View All Errors

Expand **📋 View All Errors** to view the complete error list, convenient for browsing all possible error types.

---

## FAQ

### Q: Page shows "Loading..." and doesn't respond?

**A:** Check the RPC configuration on the Environment page to ensure it can connect to the blockchain node.

### Q: Transaction fails showing "insufficient funds"?

**A:** Go to the Test Tokens page and click "Mint ETH" to get test ETH.

### Q: Can't find a certain token?

**A:**

1. Check if the token has been created/deployed on the Test Tokens page
2. Go to Environment → Symbols and click "Force Refresh" to refresh the symbol cache
3. Go to Environment → Pool Info and click "Force Refresh" to refresh pool data

### Q: Transaction still fails after configuring private key?

**A:**

1. Confirm the private key format is correct (66-character hex starting with 0x)
2. Check if Environment Type is Production - production environments prohibit simulated signing
3. Confirm the account has sufficient ETH to pay for gas

### Q: How to reset all configurations?

**A:** Click the "Clear Cache" button in each tab on the Environment page, or clear the browser's localStorage.

---

## Technical Notes

-   **Data Caching**: Pool data TTL 10 minutes, symbol TTL 24 hours
-   **RPC Rate Limiting**: ~5 req/s, batch reads use Multicall3
-   **Signing Method**: Prioritizes stored private keys; test/local environments can simulate via Hardhat/Anvil
-   **Contract Data**: Unified access via \`window.contractData.getPools()\`, direct RPC calls prohibited

---

_Last Updated: December 2025_
