# Budget Tracker

Budget Tracker is a lightweight, mobile-first personal budgeting Progressive Web App (PWA). It helps you organize monthly budgets, record expenses in Bangladeshi taka (BDT), and understand where your money is going—all without an account, backend, or external dependency.

All budget data stays in your browser's local storage. After the app shell has been cached, the tracker can also run offline.

## Features

- **Named budget workspaces** — keep Family, Personal, or other budgets independent while viewing combined monthly totals without double counting.
- **Workspace-aware month planning** — each workspace copies categories from its latest earlier month, or its own template when no earlier budget exists.
- **Shared wallets and derived balances** — track Cash, Bank, bKash, or custom wallets across every workspace without storing a mutable balance.
- **Income and opening balances** — record dated income separately from the balance a wallet started with.
- **Transfers and fees** — move money between wallets without inflating income or spending; record an optional fee as a linked budget expense.
- **Reliable expense entry** — record and edit a category, description, finite positive amount, and full local calendar date.
- **At-a-glance budget status** — see the remaining balance, total spent, daily average, days left, and recommended daily spending.
- **Budget warnings** — get visual warnings when funds are running low or a monthly budget has been exceeded.
- **Category-level tracking** — view spending and progress for every category, then expand a category to inspect, edit, or move transactions to recoverable trash.
- **Built-in analytics** — review daily spending, category breakdowns, budget status, the highest-spending day, biggest purchase, and top five expenses.
- **Monthly history** — compare total spending and leading categories across recorded months for the selected workspace.
- **Searchable expense log** — find transactions by description, category, or date.
- **Flexible category management** — add, edit, archive, restore, and drag to reorder both workspace-template and month-specific categories without disconnecting historical expenses.
- **CSV category import** — upload or paste category data, merge it with existing categories, or safely replace the target list while retaining referenced categories.
- **Data portability** — export expenses or categories as CSV, and back up or restore the full application state as JSON.
- **Installable PWA** — add the tracker to a phone or desktop home screen for a standalone app experience.
- **Offline support** — a service worker caches the application shell and prompts before activating updated versions.
- **Concurrent-tab protection** — browser writes use an origin-wide Web Lock so simultaneous tabs cannot silently overwrite one another.
- **Responsive dark interface** — optimized for mobile screens while remaining usable on desktop.

## Getting Started

The project uses plain HTML, CSS, and JavaScript. There is no build step and no package installation.

1. Clone or download the project.
2. Start a local web server from the project directory:

   ```bash
   python3 -m http.server 8000
   ```

3. Open [http://localhost:8000](http://localhost:8000) in a browser.

Opening `index.html` directly may display the interface, but serving the project over HTTP is recommended because service workers and PWA features require a secure context such as `localhost` or HTTPS.

## Using the App

1. Select or create a workspace such as Family or Personal.
2. Open **Settings** and create that workspace’s category template, or import one from CSV.
3. Select **+ New Month** and choose a month. Each workspace copies its latest earlier budget, or its own template when no earlier month exists.
4. Open **Wallets** to create each Cash, Bank, bKash, or custom wallet and enter its balance as of a chosen date.
5. Add income, transfers, or reasoned balance adjustments from **Wallets**. A transfer fee can be assigned to a workspace and category.
6. Use the **Add** tab to record a dated expense from an active wallet. Use the edit button in **Categories** or **Log** to correct it or move it to another workspace.
7. Review the workspace-specific tabs or select **All Workspaces** for combined monthly totals. Budget remaining and tracked wallet balance are intentionally separate.
8. Use **Settings → Data → Backup** regularly to download a JSON copy of your data.

## CSV Import Format

Category imports accept comma-, semicolon-, or tab-separated text. A header row is optional.

```csv
Category,Budget
Rent,15000
Groceries,4500
Internet,500
```

Imports can target either the selected workspace’s template or its active month:

- **Merge** adds new categories and updates the budget of matching category names.
- **Replace** replaces unreferenced categories. Categories used by existing expenses are retained as archived so records never disappear.

Expense CSV files are export-only and contain verified date, original legacy date, date status, workspace, category, description, and amount columns.

## Data Storage and Privacy

Budget data is stored locally in the current browser using `localStorage`; it is not sent to a server by this application. As a result:

- Data does not automatically sync between browsers or devices.
- Clearing site data or using private browsing may remove the saved information.
- Uninstalling the PWA may remove its local data, depending on the browser and operating system.
- JSON backups are the safest way to move data or protect it before clearing browser storage.

Restoring a JSON backup first validates and previews its contents. After confirmation, the app snapshots the current dataset and activates the verified replacement. Legacy unversioned backups remain supported; malformed backups and unknown future schema versions are rejected without changing current data.

Existing installations are migrated into one workspace named **Existing Budget**. The migration keeps the original records and totals together instead of guessing whether historical spending was Family or Personal.

Historical expenses are also preserved as **Wallet unassigned**. They continue to count in budget reports but do not reduce new wallet opening balances. New expenses require an active wallet, and wallet balances are recalculated from opening balances, income, adjustments, transfers, and wallet-linked expenses.

## Installing as an App

When hosted on HTTPS (or opened on `localhost`), use the browser's **Install app** or **Add to Home Screen** option. The included manifest supplies the app name, colors, portrait orientation, and icons. Once the application has been loaded successfully, its cached shell is available offline.

## Deployment

Deploy all files in this repository together on any static host, including GitHub Pages, Netlify, Cloudflare Pages, or a conventional web server. HTTPS is required in production for service-worker and installation support.

The `_headers` file asks supported hosting providers to revalidate the app entry point, storage adapter, service worker, and manifest so clients can discover compatible application updates promptly.

When changing cached assets, update `CACHE_NAME` in `sw.js` so previously installed copies refresh their cache.

## Project Structure

```text
.
├── index.html              # Interface, styles, state, and application logic
├── storage.js              # Versioned storage, validation, migration, and recovery
├── manifest.json           # PWA metadata and icon definitions
├── sw.js                   # Offline cache and update behavior
├── _headers                # Cache-control rules for supported static hosts
├── docs/
│   ├── roadmap.md          # Product phases and release gates
│   ├── implementation-status.md # Living implementation and verification log
│   ├── phase-0-test-report.md    # Phase 0 results and release findings
│   ├── phase-1-test-report.md    # Phase 1 results and release findings
│   ├── phase-2-test-report.md    # Phase 2 results and release findings
│   └── phase-3-test-report.md    # Phase 3 results and release findings
├── tests/
│   ├── storage.test.js     # Dependency-free storage safety tests
│   ├── phase0-storage.jest.test.js # Phase 0 Jest storage contracts
│   ├── phase1-storage.jest.test.js # Phase 1 normalization contracts
│   ├── phase2-storage.jest.test.js # Phase 2 workspace contracts
│   └── phase3-storage.jest.test.js # Phase 3 wallet-ledger contracts
├── e2e/
│   ├── phase0.spec.js      # Phase 0 Playwright browser workflows
│   ├── phase1.spec.js      # Phase 1 Playwright browser workflows
│   ├── phase2.spec.js      # Phase 2 Playwright browser workflows
│   └── phase3.spec.js      # Phase 3 Playwright browser workflows
├── favicon.png             # Browser favicon
├── apple-touch-icon.png    # iOS home-screen icon
├── icon-192.png            # PWA icon
├── icon-512.png            # PWA icon
└── logo-64x64.png          # Cached application logo asset
```

## Technology

- HTML5
- CSS3
- Vanilla JavaScript
- Web App Manifest
- Service Worker and Cache API
- Web Locks API
- Browser `localStorage`

## Testing

Install the test dependencies, then run all storage and browser tests:

```bash
npm install
npm test
```

Individual suites are available through `npm run test:legacy`, `npm run test:jest`, and `npm run test:playwright`. The Playwright configuration uses the installed Google Chrome channel on this macOS 12 ARM64 environment.

The current implementation status and recommended next step are documented in [`docs/implementation-status.md`](docs/implementation-status.md). Detailed evidence is in the [Phase 0](docs/phase-0-test-report.md), [Phase 1](docs/phase-1-test-report.md), [Phase 2](docs/phase-2-test-report.md), and [Phase 3](docs/phase-3-test-report.md) reports.

## Browser Support

Use a current version of Chrome, Edge, Firefox, or Safari with the Web Locks API. PWA installation behavior varies by browser and operating system. If exclusive locking is unavailable, the app fails closed instead of performing potentially unsafe writes and offers recovery guidance.
