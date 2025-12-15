# Project Architecture & Coding Guidelines

## Core layout

-   Static multi-page dashboard (no bundler); entry `index.html` links to `src/pages/{environment,testtoken,pools-vtps,swap,calc,errors,apr,arbitrage}`. Shared navbar lives in `src/components/navbar/`.
-   JavaScript is loaded via script tags and attaches globals (no modules). Key singletons: `window.environment`, `window.contracts`, `window.contractData`, `window.PoolDataManager`, `window.RpcManager`, `window.stapleCommon`.
-   ABIs reside in `abigen/**`; Solidity sources in `contracts/**`. Always verify function signatures against ABIs before changing calls.

## Contract interaction rules

-   Never guess signatures: open the matching ABI in `abigen/` and the contract source in `contracts/` before editing or adding calls.
-   Use provided getters in `src/lib/contractCalls.js` (`window.contracts.get*`) and data helpers in `window.contractData`; do not instantiate ad-hoc `ethers.Contract` instances in pages.
-   Pool data source of truth: `window.contractData.getPools()` (delegates to `environment` cache). Do not fetch pools directly via `RpcManager` or contract calls.
-   Token metadata: consume cached symbols/decimals from `environment`/pool data; UI code must not call `symbol()`/`decimals()` directly. Fallback to address truncation on failures.

## Environment & caching

-   `src/pages/environment/environment.js` manages RPC, contract addresses, users, and derived controller/incentivesController/priceProvider/mocks; state persisted in `localStorage` per network.
-   Pool cache TTL 10 minutes, symbol cache TTL 24 hours, both throttled by 10s; `getPools()` returns cached data and triggers refresh when missing/expired.
-   Changing RPC or uiPoolDataProvider re-derives controller/incentivesController and priceProvider; respect prompts that prevent mutating default networks without cloning.
-   Signer resolution via `stapleCommon.resolveSigner`: prefers stored private keys; production forbids impersonation; test/local may impersonate via hardhat/anvil JSON-RPC.

## RPC & multicall

-   All reads must go through `window.RpcManager` (rate-limited ~5 req/s). Use `RpcManager.call` for single reads and `RpcManager.multicall` to batch. Avoid raw provider calls inside loops; batch reads outside the loop.
-   `RpcManager` uses Multicall3 `aggregate3` at `0xcA11...CA11`; it supports both encoded-call objects and contract/method/args objects with `allowFailure`.

## Page patterns

-   `swap` (`swap.main.js`): builds graph from cached pools (`contractData.getPools`), derives decimals from pool data, uses `swapGraph` for path enumeration and `swapUI` for rendering; execution goes through Router. Never fetch token metadata on-chain here.
-   `pools-vtps`/`apr`/`arbitrage` pages follow the same contract data sourcing: use `environment` caches and centralized helpers, not direct RPC calls.
-   `testtoken` relies on configured `testERC20Factory` and user signer; ensure ETH mint then token mint order when adjusting flows.

## UI conventions

-   Always ensure HTML, CSS, and JS stay in sync; UI elements referenced in JS must exist in the page markup and be styled in the corresponding CSS file. Keep copy buttons wired via `stapleCommon.setupCopyDelegation`.
-   Add comments only for non-obvious logic (cache flows, throttling, signer fallbacks); keep them brief and accurate.

## UI style baseline

-   Light, neutral canvas: `--bg` #f7fafc with white cards, 1px #e2e8f0 borders, soft 12px radii, and subtle 2-4px shadows.
-   Primary accent is indigo (`--primary` #5a67d8 / hover #4c51bf); best-result highlights use indigo-purple gradients (#667eea→#764ba2) and info accents use soft blues.
-   Typography: system UI stack, sizes 12-18px; headings semibold; monospace only for numeric outputs.
-   Controls: primary buttons indigo on white text; secondary buttons white with border; compact chips use small padding. Inputs/selects share the same border, radius, and focus ring (indigo glow).
-   Layout: grid-based cards on light background, clear spacing (14-24px sections), status banners in pale backgrounds (yellow for warnings).

## Impact and dependency hygiene

-   Treat `environment` and `contractCalls` as shared infrastructure: any changes require checking all pages that rely on their globals.
-   When refactoring utilities or data shapes, update every consumer in `src/pages/**` and `src/lib/**`; avoid partial fixes.

## Quick workflow reminders

-   There is no build step: open `index.html` (or specific page) in a static server; ensure required scripts load in order.
-   Before debugging data issues, force refresh caches via Environment page buttons (pool info and symbols) after confirming RPC and uiPoolDataProvider are set.
