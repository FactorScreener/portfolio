# Portfolio

A local web app for managing your [Dhan](https://dhan.co) portfolio on your own computer. It shows your holdings, profit and loss, and allocation, and can plan and place rebalance orders for you. Nothing is stored in the cloud; the app runs on your machine and only talks to Dhan and Yahoo Finance.

## Features

The overview shows invested value, current value, total P&L, and today's change, refreshed every 30 seconds while the market is open. The allocation map is a treemap of your holdings: area is current value, colour is return.

The rebalance planner takes a target basket (typed, pasted, or CSV) and computes the whole-share buy and sell orders to get there. You review the plan, then it places the orders on Dhan. The order log records every order the app places, locally on your computer.

## Requirements

- A Dhan account
- Windows, macOS, or Linux
- An internet connection

## Install

### Windows

1. Open PowerShell (right-click the Start button > **Terminal** or **Windows PowerShell**).
2. Run:
   ```powershell
   irm https://factorscreener.com/install.ps1 | iex
   ```
   From Command Prompt instead:
   ```cmd
   powershell -c "irm https://factorscreener.com/install.ps1 | iex"
   ```
3. Follow the prompts. The app is saved to your Downloads folder by default; you can choose another location when asked.
4. Your browser opens at `http://localhost:8787`.

To start the app later, run the installer again; it updates to the latest version and starts the app.

### macOS

1. Open Terminal.
2. Run:
   ```bash
   curl -fsSL https://factorscreener.com/install | bash
   ```
3. Follow the prompts. Your browser opens at `http://localhost:8787`.

To start the app later, run the installer again: `curl -fsSL https://factorscreener.com/install | bash`. It updates to the latest version and starts the app.

### Linux

1. Run:
   ```bash
   curl -fsSL https://factorscreener.com/install | bash
   ```
2. Follow the prompts. Your browser opens at `http://localhost:8787`.

To start the app later, run the installer again: `curl -fsSL https://factorscreener.com/install | bash`. It updates to the latest version and starts the app.

### What the installer does

1. Installs Bun if needed: `irm https://bun.sh/install.ps1 | iex` on Windows, `curl -fsSL https://bun.sh/install | bash` on macOS/Linux.
2. Downloads the app into a folder named `FactorScreener.com Portfolio` in the location you confirmed (Downloads by default).
3. Runs `bun install` and `bun run build`.
4. Starts the app with `bun start` and opens your browser.

Re-running the installer updates the app to the latest version and keeps your saved settings and order log.

## Connect your Dhan account

1. In the app, open **Settings** (top right).
2. Get your credentials from Dhan: **dhan.co > Profile > DhanHQ Trading API**. Copy your **Client ID** and generate an **Access Token**.
3. Paste both into the app and click **Save**.

Dhan tokens expire after 24 hours. Open Settings and paste a fresh token on each trading day. Credentials are stored only on your computer, in `data/portfolio.sqlite` inside the app folder.

## Manual install

1. Install Bun:
   - Windows (PowerShell): `irm https://bun.sh/install.ps1 | iex`
   - macOS/Linux: `curl -fsSL https://bun.sh/install | bash`
   - Close and reopen your terminal afterwards.
2. Download the app: either the ZIP from the **Code** button on [github.com/FactorScreener/portfolio](https://github.com/FactorScreener/portfolio), or:
   ```bash
   git clone https://github.com/FactorScreener/portfolio.git
   ```
3. Build and start:
   ```bash
   cd portfolio-master     # the folder from the ZIP, or "portfolio" if you cloned
   bun install
   bun run build
   bun start
   ```
4. Open `http://localhost:8787` in your browser.

## Updating

- Re-run the installer. It replaces the app with the latest version and keeps your settings.
- With git: `git pull && bun install && bun run build` inside the app folder, then start as usual.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Browser can't reach the page | Wait a moment and refresh. Keep the server window open; closing it stops the app. |
| `irm` is not recognized | You are in Command Prompt, not PowerShell. Open PowerShell and run the command there. |
| `bun` is not recognized | Close and reopen the terminal. The installer finds Bun on its own. |
| Dhan says the token is invalid or expired | Tokens last 24 hours. Paste a fresh token in Settings. |
| "Day change" column is empty | Day-change data comes from Yahoo Finance. P&L still works if it is unreachable. |
| "Port already in use" | Another copy of the app is running. Close it and start again. |
| Windows firewall pop-up | Click **Allow**. The app needs internet access for Dhan and Yahoo. |

## Notes

- The Rebalance page places **real market orders** on your Dhan account. Review the plan before executing.
- This is a tool, not financial advice. You choose the baskets.
- Your Dhan Client ID and token are stored locally and never uploaded. The token is valid for 24 hours.

## For developers

```bash
bun install
bun run dev        # dev server with hot reload
bun run build      # production build
bun start          # production server on port 8787
bun run typecheck
```

Stack: Bun, Hono, SQLite on the server; React 19, Vite on the client. Dhan API for orders and holdings; Yahoo Finance for day-change quotes.

## License

[MIT](LICENSE)
