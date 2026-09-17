#!/usr/bin/env pwsh
# pre_release.ps1 — 交互式预发布: 填版本号 + 写 CHANGELOG
# 用法: ./pre_release.ps1 [version]
# ponytail: 假设 git checkout CHANGELOG.md 是回滚手段, 不写 .bak;
#           假设 EDITOR/code/notepad 之一存在, 不做 try/catch + OutputEncoding 防御;
#           假设 Mac 自己 `npm version` 走, 不维护 .sh 平行实现;
#           直接 git commit 不走 npm version (这机器 .npmrc git-tag-version=false 让 npm version 不 commit).

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8  # PS5.1 中文显示
$ErrorActionPreference = "Stop"

$Proj = $PSScriptRoot
$Changelog = Join-Path $Proj "CHANGELOG.md"
$Current = (Get-Content (Join-Path $Proj "package.json") -Raw | ConvertFrom-Json).version

$Version = $args[0]
if (-not $Version) {
    $p = $Current.Split('.')
    $Suggested = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
    $Version = (Read-Host "新版本号 [默认 $Suggested]").Trim()
    if (-not $Version) { $Version = $Suggested }
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Write-Host "❌ 格式无效: $Version" -ForegroundColor Red; exit 1 }
if ($Version -eq $Current) { Write-Host "❌ 与当前版本相同" -ForegroundColor Red; exit 1 }

$Date = Get-Date -Format 'yyyy-MM-dd'
$Tmp = [System.IO.Path]::GetTempFileName()
@"
## [$Version] - $Date

> 一句话总结

### Added
- 

### Changed
- 

### Fixed
- 
"@ | Set-Content $Tmp -Encoding UTF8

$Editor = if ($Env:EDITOR) { $Env:EDITOR }
          elseif (Get-Command code -ErrorAction SilentlyContinue) { 'code --wait' }
          elseif (Get-Command notepad -ErrorAction SilentlyContinue) { 'notepad' }
          else { Write-Host "❌ 没编辑器, 设 `$env:EDITOR"; exit 1 }
# 用 cmd /c 让多 word editor (如 "code --wait") 正确解析; PowerShell 的 & 把 "code --wait" 当一个命令名查找会失败
& cmd /c "$Editor `"$Tmp`""

if ((Get-Content $Tmp -Raw) -notmatch "## \[$Version\]") { Write-Host "❌ 标题丢了, 中止"; exit 1 }

$InsertIdx = (Select-String -Path $Changelog -Pattern '^## \[\d' | Select-Object -First 1).LineNumber - 1
if ($InsertIdx -lt 0) { Write-Host "❌ CHANGELOG 找不到 ## [version] 锚点"; exit 1 }

$Lines = Get-Content $Changelog
@($Lines[0..($InsertIdx-1)]) + @(Get-Content $Tmp) + @('') + @($Lines[$InsertIdx..($Lines.Count-1)]) |
    Set-Content $Changelog -Encoding UTF8

Remove-Item $Tmp -Force

# 直接做 npm version 该做的事 (npm version 在这机器 npmrc git-tag-version=false 下不 commit, bypass)
# 用 node -e 改写 package.json 以保持 2 空格缩进 (PowerShell 的 ConvertTo-Json 会改成 4 空格)
node -e "`$pkg = require('./package.json'); `$pkg.version = process.argv[1]; require('fs').writeFileSync('package.json', JSON.stringify(`$pkg, null, 2) + '\n')" $Version
& node scripts/sync-version.js
git add CHANGELOG.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "v$Version"
git tag "v$Version"
if ($LASTEXITCODE) { Write-Host "❌ git commit/tag 失败 (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }

Write-Host "✅ CHANGELOG.md 已加入 ## [$Version]" -ForegroundColor Green
Write-Host "✅ v$Version tag 已创建. 下一步: ./publish_windows.ps1" -ForegroundColor Green
