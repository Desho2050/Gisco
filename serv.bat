@echo off
setlocal enableextensions
title GISCO - Local Server Bootstrap
cd /d "%~dp0"

REM ------------------------------------------------------------
REM Helper: detect command presence
REM ------------------------------------------------------------
where node >nul 2>&1 && set "HAS_NODE=1"
where winget >nul 2>&1 && set "HAS_WINGET=1"
where py >nul 2>&1 && set "HAS_PY=1"
where python >nul 2>&1 && set "HAS_PYTHON=1"

REM ------------------------------------------------------------
REM Install Node.js silently if missing
REM ------------------------------------------------------------
if not defined HAS_NODE (
  echo [INFO] Node.js not found. Attempting silent install...
  if defined HAS_WINGET (
    echo [INFO] Using winget to install Node.js LTS (silent).
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  ) else (
    echo [INFO] winget not available. Downloading Node.js LTS MSI...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $u='https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi'; $p=Join-Path $env:TEMP 'node-lts.msi'; Invoke-WebRequest -Uri $u -OutFile $p -UseBasicParsing; Start-Process msiexec -ArgumentList '/i', $p, '/qn', '/norestart' -Wait; Remove-Item $p -Force } catch { Write-Error $_; exit 1 }"
  )
)

REM Refresh detection after install
where node >nul 2>&1 && set "HAS_NODE=1"

REM ------------------------------------------------------------
REM Start server: prefer live-server, then http-server, then Python, then PS
REM ------------------------------------------------------------
if defined HAS_NODE (
  where live-server >nul 2>&1 && set "HAS_LIVE=1"
  if not defined HAS_LIVE (
    echo [INFO] Installing live-server globally (silent)...
    call npm config set fund false >nul 2>&1
    call npm config set audit false >nul 2>&1
    call npm install -g live-server --no-fund --no-audit --loglevel=error
    where live-server >nul 2>&1 && set "HAS_LIVE=1"
  )
  if defined HAS_LIVE (
    echo [INFO] Starting live-server on http://127.0.0.1:5173/
    start "GISCO Server 5173" cmd /c "cd /d \"%~dp0\" && live-server --port=5173 --no-browser"
  ) else (
    echo [WARN] live-server not available. Falling back to http-server (npx).
    start "GISCO Server 5173" cmd /c "cd /d \"%~dp0\" && npx --yes http-server -p 5173 -c-1"
  )
  timeout /t 2 >nul
  start "GISCO Dashboard" "http://127.0.0.1:5173/main%20page.html"
  goto :EOF
)

if defined HAS_PY (
  echo [INFO] Node not available. Using Python (py) simple server on 5173.
  start "GISCO Server 5173" cmd /c "cd /d \"%~dp0\" && py -m http.server 5173"
  timeout /t 2 >nul
  start "GISCO Dashboard" "http://127.0.0.1:5173/main%20page.html"
  goto :EOF
)

if defined HAS_PYTHON (
  echo [INFO] Node not available. Using Python simple server on 5173.
  start "GISCO Server 5173" cmd /c "cd /d \"%~dp0\" && python -m http.server 5173"
  timeout /t 2 >nul
  start "GISCO Dashboard" "http://127.0.0.1:5173/main%20page.html"
  goto :EOF
)

echo [WARN] Node and Python not available. Starting PowerShell static server.
powershell -NoProfile -ExecutionPolicy Bypass -Command "
  $root = Split-Path -Parent $MyInvocation.MyCommand.Path;
  Set-Location $root;
  $prefix = 'http://127.0.0.1:5173/';
  Add-Type -AssemblyName System.Net;
  $h = New-Object System.Net.HttpListener;
  $h.Prefixes.Add($prefix);
  $h.Start();
  Write-Host ('[INFO] PowerShell server running at ' + $prefix);
  Start-Process 'http://127.0.0.1:5173/main%20page.html';
  while ($h.IsListening) {
    $ctx = $h.GetContext();
    $reqPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'));
if ([string]::IsNullOrWhiteSpace($reqPath)) { $reqPath = 'index.html' }
    $full = Join-Path $root $reqPath;
    if (-not (Test-Path $full)) { $ctx.Response.StatusCode = 404; $bytes = [Text.Encoding]::UTF8.GetBytes('Not Found'); $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length); $ctx.Response.Close(); continue }
    $ext = [IO.Path]::GetExtension($full).ToLower();
    switch ($ext) {
      '.html' { $ct='text/html' }
      '.xlsx' { $ct='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      '.js'   { $ct='application/javascript' }
      '.css'  { $ct='text/css' }
      default { $ct='application/octet-stream' }
    }
    $bytes = [IO.File]::ReadAllBytes($full);
    $ctx.Response.ContentType = $ct;
    $ctx.Response.ContentLength64 = $bytes.Length;
    $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length);
    $ctx.Response.Close();
  }
"

if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Could not start any local server.
  echo        Please install Node.js LTS manually and rerun serv.bat
  pause
)

endlocal
pause