# Budget Tracker

Budget Tracker is a lightweight, mobile-first personal budgeting Progressive Web App (PWA). It helps you organize monthly budgets, record expenses in Bangladeshi taka (BDT), and understand where your money is going—all without an account, backend, or external dependency.

All budget data stays in your browser's local storage. After the app shell has been cached, the tracker can also run offline.

## Features

- **Monthly budget workspaces** — create and switch between months, with categories and budgets copied from the latest month or the global template.
- **Fast expense entry** — record a category, description, and amount for each expense.
- **At-a-glance budget status** — see the remaining balance, total spent, daily average, days left, and recommended daily spending.
- **Budget warnings** — get visual warnings when funds are running low or a monthly budget has been exceeded.
- **Category-level tracking** — view spending and progress for every category, then expand a category to inspect or delete its transactions.
- **Built-in analytics** — review daily spending, category breakdowns, budget status, the highest-spending day, biggest purchase, and top five expenses.
- **Monthly history** — compare total spending and leading categories across recorded months.
- **Searchable expense log** — find transactions by description, category, or date.
- **Flexible category management** — add, edit, delete, and drag to reorder both global-template and month-specific categories.
- **CSV category import** — upload or paste category data, merge it with existing categories, or replace the target list.
- **Data portability** — export expenses or categories as CSV, and back up or restore the full application state as JSON.
- **Installable PWA** — add the tracker to a phone or desktop home screen for a standalone app experience.
- **Offline support** — a service worker caches the application shell and automatically activates updated versions.
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

1. Open **Settings** and create a global category template, or import one from CSV.
2. Select **+ New Month** and choose a month. The first month copies the global template; later months copy categories and budgets from the latest existing calendar month.
3. Use the **Add** tab to record expenses.
4. Review the **Categories**, **Analytics**, **History**, and **Log** tabs to monitor spending.
5. Use **Settings → Data → Backup** regularly to download a JSON copy of your data.

## CSV Import Format

Category imports accept comma-, semicolon-, or tab-separated text. A header row is optional.

```csv
Category,Budget
Rent,15000
Groceries,4500
Internet,500
```

Imports can target either the global template or the active month:

- **Merge** adds new categories and updates the budget of matching category names.
- **Replace** clears the target category list before importing the supplied rows.

Expense CSV files are export-only and contain `Date`, `Category`, `Description`, and `Amount (BDT)` columns.

## Data Storage and Privacy

Budget data is stored locally in the current browser using `localStorage`; it is not sent to a server by this application. As a result:

- Data does not automatically sync between browsers or devices.
- Clearing site data or using private browsing may remove the saved information.
- Uninstalling the PWA may remove its local data, depending on the browser and operating system.
- JSON backups are the safest way to move data or protect it before clearing browser storage.

Restoring a JSON backup replaces the application's current months and category template after confirmation.

## Installing as an App

When hosted on HTTPS (or opened on `localhost`), use the browser's **Install app** or **Add to Home Screen** option. The included manifest supplies the app name, colors, portrait orientation, and icons. Once the application has been loaded successfully, its cached shell is available offline.

## Deployment

Deploy all files in this repository together on any static host, including GitHub Pages, Netlify, Cloudflare Pages, or a conventional web server. HTTPS is required in production for service-worker and installation support.

The `_headers` file disables caching for `sw.js` and `manifest.json` on hosting providers that support this configuration, helping clients discover application updates promptly.

When changing cached assets, update `CACHE_NAME` in `sw.js` so previously installed copies refresh their cache.

## Project Structure

```text
.
├── index.html              # Interface, styles, state, and application logic
├── manifest.json           # PWA metadata and icon definitions
├── sw.js                   # Offline cache and update behavior
├── _headers                # Cache-control rules for supported static hosts
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
- Browser `localStorage`

## Browser Support

Use a current version of Chrome, Edge, Firefox, or Safari. PWA installation behavior varies by browser and operating system, but the core budget tracker works as a standard responsive web application wherever modern JavaScript and `localStorage` are supported.
