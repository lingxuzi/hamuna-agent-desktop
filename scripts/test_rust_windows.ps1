<#
.SYNOPSIS
    Runs the Rust test suite on Windows.

.DESCRIPTION
    Plain `cargo test --manifest-path src-tauri/Cargo.toml` cannot run here: it
    compiles fine and then every test binary dies before main() with
    STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139), so cargo reports "test failed"
    having executed zero tests.

    Cause. tauri_build::build() compiles the Windows application manifest - the
    one carrying the Common Controls 6.0 SxS dependency - into
    OUT_DIR/resource.lib and links it with `cargo:rustc-link-arg-bins`, i.e.
    bins only. The test harness for the lib is not a bin target, so it never
    receives that manifest. The harness statically imports
    comctl32!TaskDialogIndirect (via the `windows` crate), and that symbol only
    exists in the Common Controls 6.0 assembly: System32\comctl32.dll is the v5
    stub (119 exports, no TaskDialog* at all), and the SxS loader only
    substitutes v6 when the process manifest asks for it.

    Why a script rather than a build.rs fix. Scoping the same .lib to the test
    targets needs `cargo:rustc-link-arg-tests`, and cargo rejects that
    instruction for this package ("does not have a test target") because the
    package declares no [[test]] target. The unscoped `cargo:rustc-link-arg`
    that cargo does accept collides with tauri-build's own -bins arg: the
    archive reaches the link line twice and CVTRES fails with CVT1100 +
    LNK1123, which breaks `cargo build` itself.

    So this writes the manifest as a side-by-side file next to the built test
    binary instead - the documented Windows mechanism for supplying a manifest
    externally. It changes nothing in the build graph.

.PARAMETER Filter
    Passed straight through to the test harness (substring match on test name).

.PARAMETER TestThreads
    libtest -j value. 0 leaves the harness default.

.PARAMETER SkipBuild
    Reuse the existing test binary instead of re-running `cargo test --no-run`.
#>
param(
    [string]$Filter = "",
    [int]$TestThreads = 0,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot

$manifestLines = @(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">',
    '  <assemblyIdentity type="win32" name="HamunaAgent.TestHarness" version="1.0.0.0" processorArchitecture="*"/>',
    '  <dependency>',
    '    <dependentAssembly>',
    '      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>',
    '    </dependentAssembly>',
    '  </dependency>',
    '</assembly>',
    ''
)

Push-Location $repoRoot

if (-not $SkipBuild) {
    # Pipe rather than let cargo inherit this process's console handles: an
    # inheriting child writes at its own file offset and overwrites whatever
    # this script had already emitted into a redirected stdout.
    & cargo test --manifest-path src-tauri/Cargo.toml --no-run 2>&1 |
        ForEach-Object { Write-Output $_ }
    $buildCode = $LASTEXITCODE
    if ($buildCode -ne 0) {
        Pop-Location
        Write-Error "cargo test --no-run failed ($buildCode)"
        exit 1
    }
}

$bin = Get-ChildItem "src-tauri/target/debug/deps/app_lib-*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $bin) {
    Pop-Location
    Write-Error "lib test binary not found under src-tauri/target/debug/deps"
    exit 1
}

[System.IO.File]::WriteAllLines("$($bin.FullName).manifest", $manifestLines)

$runArgs = @()
if ($TestThreads -gt 0) { $runArgs += @("--test-threads", "$TestThreads") }
if ($Filter) { $runArgs += $Filter }

Write-Output "running $($bin.Name) $($runArgs -join ' ')"
& $bin.FullName @runArgs
$code = $LASTEXITCODE
Pop-Location
exit $code
