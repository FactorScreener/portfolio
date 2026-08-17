<#
  Portfolio one-time installer for Windows.

  Usage: paste this into PowerShell:
      irm https://factorscreener.com/install.ps1 | iex

  Or from cmd:
      powershell -c "irm https://factorscreener.com/install.ps1 | iex"
#>

function Main {
    $ErrorActionPreference = 'Stop'
    $Host.UI.RawUI.WindowTitle = 'Portfolio - Installer'

    $REPO_ZIP = 'https://github.com/FactorScreener/portfolio/archive/refs/heads/master.zip'
    $APP_URL  = 'http://localhost:8787'

    Write-Host ''
    Write-Host ' ============================================================'
    Write-Host '   Portfolio installer'
    Write-Host ''
    Write-Host '   This runs a one-time setup on your computer:'
    Write-Host '     1. Install Bun - the free engine that runs the app'
    Write-Host '     2. Download the app to your Downloads folder'
    Write-Host '     3. Build it'
    Write-Host '     4. Start it and open your browser'
    Write-Host ''
    Write-Host '   Nothing is uploaded anywhere. Your data stays on this PC.'
    Write-Host ' ============================================================'
    Write-Host ''

    # ---- 1. Bun ------------------------------------------------------------
    $BUN = $null
    $bunCmd = Get-Command bun -ErrorAction SilentlyContinue
    if ($bunCmd) {
        $BUN = $bunCmd.Source
    } elseif (Test-Path -LiteralPath "$env:USERPROFILE\.bun\bin\bun.exe") {
        $BUN = "$env:USERPROFILE\.bun\bin\bun.exe"
    } elseif ($env:BUN_INSTALL -and (Test-Path -LiteralPath "$env:BUN_INSTALL\bin\bun.exe")) {
        $BUN = "$env:BUN_INSTALL\bin\bun.exe"
    }

    if (-not $BUN) {
        Write-Host ' [1/5] Bun is not installed. Installing it now...'
        try {
            irm https://bun.sh/install.ps1 | iex
        } catch {
            throw "Bun did not finish installing ($($_.Exception.Message)). You can install it yourself from https://bun.sh and then run this installer again."
        }
        $BUN = "$env:USERPROFILE\.bun\bin\bun.exe"
        if (-not (Test-Path -LiteralPath $BUN)) {
            throw 'Bun did not finish installing. You can install it yourself from https://bun.sh and then run this installer again.'
        }
        Write-Host ' Done.'
    }
    Write-Host ''
    Write-Host ' [1/5] Bun is ready.'

    # ---- 2. Where to install ------------------------------------------------
    $DEFAULT_DIR = "$env:USERPROFILE\Downloads"
    Write-Host ''
    $APP_DIR = Read-Host " [2/5] Press Enter for $DEFAULT_DIR, or type another folder"
    $APP_DIR = $APP_DIR.Trim().Trim('"').Trim("'")
    if ([string]::IsNullOrWhiteSpace($APP_DIR)) { $APP_DIR = $DEFAULT_DIR }
    if ($APP_DIR -eq '~') {
        $APP_DIR = $env:USERPROFILE
    } elseif ($APP_DIR.StartsWith('~\')) {
        $APP_DIR = $env:USERPROFILE + $APP_DIR.Substring(1)
    }
    $APP_DIR = [Environment]::ExpandEnvironmentVariables($APP_DIR)
    if (-not (Test-Path -LiteralPath $APP_DIR)) {
        Write-Host "  Creating folder: $APP_DIR"
        New-Item -ItemType Directory -Path $APP_DIR -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $APP_DIR)) {
        throw "Could not create `"$APP_DIR`". Please try again with a different folder."
    }

    # ---- 3. Download ---------------------------------------------------------
    Write-Host ''
    Write-Host ' [3/5] Downloading the app from GitHub...'
    $ZIP = Join-Path $APP_DIR 'portfolio-master.zip'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $REPO_ZIP -OutFile $ZIP -UseBasicParsing
    } catch {
        Write-Host ''
        throw 'Download failed. Check your internet connection and try again.'
    }

    # ---- 4. Unpack -----------------------------------------------------------
    Write-Host ''
    Write-Host ' [4/5] Unpacking the app...'
    $APP_PATH = Join-Path $APP_DIR 'FactorScreener.com Portfolio'
    $UNPACKED = Join-Path $APP_DIR 'portfolio-master'
    $OLD_DB    = Join-Path $APP_PATH 'data\portfolio.sqlite'
    $DB_BACKUP = Join-Path $env:TEMP 'portfolio-sqlite-backup'
    if (Test-Path -LiteralPath $OLD_DB) {
        Copy-Item -LiteralPath $OLD_DB -Destination $DB_BACKUP -Force
    }
    if (Test-Path -LiteralPath $APP_PATH) {
        Write-Host "  Replacing an older copy in: $APP_PATH"
        Remove-Item -LiteralPath $APP_PATH -Recurse -Force
    }
    if (Test-Path -LiteralPath $UNPACKED) {
        Remove-Item -LiteralPath $UNPACKED -Recurse -Force
    }
    try {
        Expand-Archive -LiteralPath $ZIP -DestinationPath $APP_DIR -Force
    } catch {
        Write-Host ''
        throw 'Could not unpack the download. Please run this installer again.'
    }
    Remove-Item -LiteralPath $ZIP -Force
    Move-Item -LiteralPath $UNPACKED -Destination $APP_PATH
    if (Test-Path -LiteralPath $DB_BACKUP) {
        New-Item -ItemType Directory -Path (Join-Path $APP_PATH 'data') -Force | Out-Null
        Copy-Item -LiteralPath $DB_BACKUP -Destination $OLD_DB -Force
        Remove-Item -LiteralPath $DB_BACKUP -Force
        Write-Host '  Kept your saved settings from the previous install.'
    }

    # ---- 5. Build ------------------------------------------------------------
    Write-Host ''
    Write-Host ' [5/5] Installing packages and building. First run takes a minute...'
    Push-Location $APP_PATH
    try {
        & $BUN install
        if ($LASTEXITCODE -ne 0) { throw 'bun install failed' }
        & $BUN run build
        if ($LASTEXITCODE -ne 0) { throw 'bun run build failed' }
    } finally {
        Pop-Location
    }

    # ---- Start now -----------------------------------------------------------
    Write-Host ''
    Write-Host ' ============================================================'
    Write-Host '   Setup complete. Starting the app now...'
    Write-Host ''
    Write-Host '   A minimized "Portfolio server" window keeps the app'
    Write-Host '   running. Close it when you are done.'
    Write-Host ''
    Write-Host "   Your browser should open at $APP_URL shortly."
    Write-Host ''
    Write-Host '   NEXT TIME, run this installer again - it updates'
    Write-Host '   the app to the latest version and starts it.'
    Write-Host ' ============================================================'
    Write-Host ''

    Start-Process -FilePath $BUN -ArgumentList 'start' -WorkingDirectory $APP_PATH -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Start-Process $APP_URL
    Write-Host '  All done. Enjoy!'
    Write-Host ''
}

try {
    Main
} catch {
    Write-Host ''
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Read-Host '  Press Enter to close'
}
