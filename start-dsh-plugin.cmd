@echo off
rem ============================================================
rem  Start DSH Web GUI with the dsh-LorebookMD patch loaded.
rem  Target: http://127.0.0.1:3080
rem  If the server is already running, just open the browser and
rem  remind you to restart with --patch to pick up dsh-LorebookMD.
rem ============================================================
setlocal
set "URL=http://127.0.0.1:3080"
set "NODE=C:\Program Files\nodejs\node.exe"
set "CLI=C:\Users\yuyon\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js"
set "PATCH=%~dp0cordis.yml"

rem --- 1. Is the server already up? ---
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  echo [DSH] Server already running on %URL%.
  echo [DSH] It was NOT started with --patch, so dsh-LorebookMD is not loaded.
  echo [DSH] Close the existing server window and run this script again.
  start "" "%URL%"
  exit /b 1
)

rem --- 2. Start the server with the dsh-LorebookMD overlay in its own console window ---
start "DeepSeek Harness Server (dsh-LorebookMD)" /D "%~dp0" cmd /k ""%NODE%" "%CLI%" web --patch "%PATCH%""

rem --- 3. Poll until the port responds, then open the browser ---
powershell -NoProfile -Command "$u='%URL%'; for($i=0;$i -lt 120;$i++){ try { $r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ Start-Process $u; exit 0 } } catch { } Start-Sleep -Milliseconds 500 }"
if not %errorlevel%==0 (
  echo.
  echo [DSH] The server did not become ready in time. Check the
  echo [DSH] "DeepSeek Harness Server (dsh-LorebookMD)" window for logs.
  echo [DSH] If port 3080 is occupied by another process, close it and retry.
)
exit /b %errorlevel%
