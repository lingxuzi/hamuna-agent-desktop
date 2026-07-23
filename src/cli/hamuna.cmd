@echo off
:: hamuna CLI wrapper for Windows cmd.exe
:: Invokes the bundled Node.js runtime on hamuna.js (esbuild output).
setlocal

:: Use node from PATH first (the app injects its bundled Node.js dir)
for %%b in (node.exe) do (
  if not "%%~$PATH:b"=="" (
    "%%~$PATH:b" "%~dp0hamuna" %*
    exit /b %ERRORLEVEL%
  )
)

echo Error: Node.js runtime not found. Launch HamunaAgent.app at least once to install its bundled Node, or install Node.js from https://nodejs.org.
exit /b 3
