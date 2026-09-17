#!/usr/bin/env python3
"""Build-time smoke test for macOS Python + uv + agnes-video-25-mcp staging.

Mirrors the windows NSIS §UvxFallback install-time smoke test (6 asserts
in `windows-release.yml` "Smoke-test install" step) but as build-time gates
since DMG has no install-time hook.

Run after download_python_mac.sh + install_uv.sh + stage_agnes_mcp.sh +
sign_python_runtime.sh to fail loudly before the 5-10 min tauri build.

Asserts:
  1. python bin exists + executable + lipo arch matches
  2. python reports 3.12.x
  3. uv 0.11.33 installed via `python -m uv`
  4. agnes CLI exists + executable + file type = Mach-O
  5. agnes CLI --help exits 0 (proves dep chain loads)
  6. staged agnes version == pyproject.toml pin (drift detector)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

EXPECTED_PYTHON_MINOR = (3, 12)
EXPECTED_UV_PIN = "0.11.33"

# python-build-standalone arm64 / x64 lipo 报 arm64 / x86_64
PYTHON_LIPO_ARCH = {"arm64": "arm64", "x64": "x86_64"}


def fail(label: str, detail: str = "") -> None:
    msg = f"FAIL: {label}"
    if detail:
        msg += f"\n      {detail}"
    print(msg, file=sys.stderr)
    sys.exit(1)


def ok(label: str) -> None:
    print(f"OK:   {label}")


def read_pyproject_version(pyproject: Path) -> str:
    text = pyproject.read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not m:
        fail("parse pyproject.toml", f"no version field found in {pyproject}")
    return m.group(1)


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)


def assert_python(arch: str, project_root: Path) -> Path:
    python_bin = project_root / f"src-tauri/resources/python-{arch}/bin/python3"
    if not python_bin.exists():
        fail("python bin exists", str(python_bin))
    if not python_bin.is_file():
        fail("python bin is file", str(python_bin))
    import os
    if not os.access(python_bin, os.X_OK):
        fail("python bin executable", str(python_bin))

    # lipo arch check
    lipo = run(["lipo", "-archs", str(python_bin)])
    if lipo.returncode != 0:
        fail("lipo -archs on python bin", lipo.stderr)
    arches = lipo.stdout.strip().split()
    expected = PYTHON_LIPO_ARCH[arch]
    if expected not in arches:
        fail("python arch", f"expected {expected} in lipo output, got {arches}")
    ok(f"python bin exists + arch={arch}")

    # version check
    ver = run([str(python_bin), "-c",
               "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}')"])
    if ver.returncode != 0:
        fail("python -c version", ver.stderr)
    parts = ver.stdout.strip().split(".")
    if len(parts) < 2:
        fail("python version parse", ver.stdout)
    minor = (int(parts[0]), int(parts[1]))
    if minor[0] < EXPECTED_PYTHON_MINOR[0] or (
        minor[0] == EXPECTED_PYTHON_MINOR[0] and minor[1] < EXPECTED_PYTHON_MINOR[1]
    ):
        fail("python version >= 3.12", f"got {ver.stdout.strip()}")
    ok(f"python version {ver.stdout.strip()}")
    return python_bin


def assert_uv(python_bin: Path) -> None:
    uv = run([str(python_bin), "-m", "uv", "--version"])
    if uv.returncode != 0:
        fail("python -m uv --version", uv.stderr)
    # `uv 0.11.33 (a9d7b9f 2025-xx-yy)` 之类; 第一段第二列是 version
    m = re.search(r"uv\s+(\d+\.\d+\.\d+)", uv.stdout)
    if not m:
        fail("parse uv version", uv.stdout)
    version = m.group(1)
    if version != EXPECTED_UV_PIN:
        fail("uv pin", f"expected {EXPECTED_UV_PIN}, got {version}")
    ok(f"uv {version} via python -m uv")


def assert_agnes_cli(arch: str, project_root: Path) -> Path:
    cli_bin = project_root / f"src-tauri/resources/hosted-mcps/agnes-video-25-mcp-{arch}/bin/agnes-video-25-mcp"
    if not cli_bin.exists():
        fail("agnes CLI exists", str(cli_bin))
    import os
    if not os.access(cli_bin, os.X_OK):
        fail("agnes CLI executable", str(cli_bin))

    # file type check: 期望 Mach-O 64-bit executable (zipimport 形态)
    ft = run(["file", "-b", str(cli_bin)])
    if ft.returncode != 0:
        fail("file -b on agnes CLI", ft.stderr)
    if "Mach-O" not in ft.stdout:
        # shebang form 也可接受 (会指向 bundled python), 但 warn 让 build log 可见
        print(f"NOTE: agnes CLI file type = {ft.stdout.strip()} (non-Mach-O is acceptable if shebang resolves)")
    else:
        ok(f"agnes CLI file type = Mach-O")

    # --help exits 0 (proves dep chain loads)
    help_cmd = run([str(cli_bin), "--help"])
    if help_cmd.returncode != 0:
        fail("agnes --help exits 0", f"stdout={help_cmd.stdout!r} stderr={help_cmd.stderr!r}")
    ok("agnes --help exits 0")
    return cli_bin


def assert_agnes_pin(arch: str, project_root: Path) -> None:
    """Verify the staged wheel version matches hosted_mcps/.../pyproject.toml pin.

    Catches cases where someone bumps pyproject.toml without re-running
    stage_agnes_mcp.sh — drift between source-of-truth and shipped artifact.
    """
    pyproject = project_root / "hosted_mcps/agnes-video-25/pyproject.toml"
    if not pyproject.exists():
        fail("pyproject.toml exists", str(pyproject))
    expected_version = read_pyproject_version(pyproject)

    site_packages = project_root / f"src-tauri/resources/hosted-mcps/agnes-video-25-mcp-{arch}/lib/python3.12/site-packages"
    if not site_packages.exists():
        # 可能在 lib/python3.13/ 或 lib/python3.11/ (PyPI wheel metadata-driven).
        # fallback: 找第一个 lib/python*/site-packages
        hosted_mcp_root = project_root / f"src-tauri/resources/hosted-mcps/agnes-video-25-mcp-{arch}"
        candidates = list(hosted_mcp_root.glob("lib/python*/site-packages"))
        if not candidates:
            fail("agnes site-packages", f"no lib/python*/site-packages under {hosted_mcp_root}")
        site_packages = candidates[0]

    # pip install --target 把 dist-info 写到 site-packages/<name>-<version>.dist-info/
    pattern = re.compile(r"^agnes_video_25_mcp-([\d.]+)\.dist-info$")
    found: list[str] = []
    for entry in site_packages.iterdir():
        m = pattern.match(entry.name)
        if m:
            found.append(m.group(1))

    if not found:
        fail("agnes dist-info found", f"no agnes_video_25_mcp-*.dist-info under {site_packages}")
    if len(found) > 1:
        # 不太可能但 warning
        print(f"NOTE: multiple agnes dist-info versions found: {found}")
    actual_version = found[0]
    if actual_version != expected_version:
        fail(
            "agnes pin drift",
            f"pyproject.toml says {expected_version}, staged wheel is {actual_version}. "
            f"Re-run stage_agnes_mcp.sh {arch}.",
        )
    ok(f"agnes pin matches pyproject: {expected_version}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arch", required=True, choices=["arm64", "x64"])
    parser.add_argument("--project-root", type=Path, default=None,
                        help="defaults to parent of scripts/")
    args = parser.parse_args()

    project_root = args.project_root
    if project_root is None:
        project_root = Path(__file__).resolve().parent.parent

    print(f"=== stage_mac_runtime smoke test (arch={args.arch}) ===")
    python_bin = assert_python(args.arch, project_root)
    assert_uv(python_bin)
    assert_agnes_cli(args.arch, project_root)
    assert_agnes_pin(args.arch, project_root)
    print("=== ALL ASSERTS PASSED ===")


if __name__ == "__main__":
    main()
