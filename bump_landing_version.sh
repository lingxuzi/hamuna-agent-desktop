#!/usr/bin/env bash
# Bump the landing page's hard-coded Windows download version from the R2
# production manifest. Run this after `publish_release.sh` / `publish_windows.ps1`
# uploads a new build so the landing page's CTA points at the new installer.
#
# Source-of-truth = R2 prod bucket, same `update/windows-x86_64.json` that
# `src-tauri/src/updater.rs::check_update_on_startup` reads via Tauri updater.
#
# What it changes in `pages/landing/index.html`:
#   - `KNOWN_VERSION`     (script const)
#   - `KNOWN_INSTALLER`   (script const)
#   - `KNOWN_SIZE_MB`     (script const, rounded from HEAD Content-Length)
#   - HTML fallback `<span data-i18n="hero.anchor.ver">…</span>` × 1
#   - HTML fallback `<span class="v" id="dl-ver">…</span>` × 1
#   - i18n dict `hero.anchor.ver` × 2 (en + zh)
#
# What it does NOT do:
#   - Does not push to remote. Commit the diff yourself, or hook into the
#     publish script yourself.
#   - Does not regenerate CSS / rebuild web. `pages/landing/` is static, no build.

set -euo pipefail

R2_BASE="https://pub-2d5b7e0153e94f999bdfea020fb31629.r2.dev"
MANIFEST_URL="${R2_BASE}/update/windows-x86_64.json"
LANDING="pages/landing/index.html"

if [[ ! -f "$LANDING" ]]; then
  echo "error: $LANDING not found (run from repo root)" >&2
  exit 1
fi

# Pull manifest. Use Python (BSD/GNU portable) to parse JSON instead of fragile sed.
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found in PATH" >&2
  exit 1
fi

echo "fetching $MANIFEST_URL ..."
MANIFEST="$(curl -fsSL "$MANIFEST_URL")"

read -r VERSION INSTALLER < <(printf '%s' "$MANIFEST" | python3 -c '
import json, sys
m = json.load(sys.stdin)
v = m.get("version", "")
inst = (m.get("downloads") or {}).get("installer") or m.get("url") or ""
print(v, inst)
')

if [[ -z "$VERSION" || -z "$INSTALLER" ]]; then
  echo "error: failed to parse version/installer from manifest" >&2
  echo "manifest:" >&2
  printf '%s\n' "$MANIFEST" >&2
  exit 1
fi

# Probe installer size via HEAD. macOS / Linux curl differ; use python again.
SIZE_BYTES="$(python3 - "$INSTALLER" <<'PY'
import sys, urllib.request
# Cloudflare R2 returns 403 on HEAD when the User-Agent is Python-urllib/3.x;
# send a plain UA so the bucket metadata match knows we're not a scraper.
ua = {"User-Agent": "hamuna-bump/1.0"}
try:
    req = urllib.request.Request(sys.argv[1], method="HEAD", headers=ua)
    with urllib.request.urlopen(req, timeout=15) as r:
        cl = r.headers.get("Content-Length")
        print(cl or "")
except Exception as e:
    print(f"warning: HEAD failed: {e}", file=sys.stderr)
    print("")
PY
)"

if [[ -n "$SIZE_BYTES" && "$SIZE_BYTES" =~ ^[0-9]+$ ]]; then
  # Round to nearest MB (ceil-ish: 251_445_867 → 240).
  SIZE_MB="$(( (SIZE_BYTES + 524288) / 1048576 ))"
else
  echo "warning: HEAD $INSTALLER returned no Content-Length; keeping existing KNOWN_SIZE_MB" >&2
  SIZE_MB="$(grep -E 'KNOWN_SIZE_MB' "$LANDING" | head -n1 | sed -nE 's/.*KNOWN_SIZE_MB[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p')"
  : "${SIZE_MB:=0}"
fi

echo
echo "manifest says:"
echo "  version   = $VERSION"
echo "  installer = $INSTALLER"
echo "  size      = ${SIZE_MB} MB (${SIZE_BYTES:-unknown} bytes)"
echo

# Sanity-check: script-const values present in file?
grep -q "KNOWN_VERSION"      "$LANDING" || { echo "error: KNOWN_VERSION not found in $LANDING" >&2; exit 1; }
grep -q "KNOWN_INSTALLER"    "$LANDING" || { echo "error: KNOWN_INSTALLER not found in $LANDING" >&2; exit 1; }
grep -q "KNOWN_SIZE_MB"      "$LANDING" || { echo "error: KNOWN_SIZE_MB not found in $LANDING" >&2; exit 1; }

# Save the user-supplied values verbatim into a Python script that does the
# actual substitution — avoids the bash/awk template-literal quoting minefield.
LANDING="$LANDING" VERSION="$VERSION" INSTALLER="$INSTALLER" SIZE_MB="$SIZE_MB" python3 - <<'PY'
import os, re, sys
landing = os.environ["LANDING"]
ver = os.environ["VERSION"]
inst = os.environ["INSTALLER"]
size = os.environ["SIZE_MB"]

with open(landing, encoding="utf-8") as f:
    src = f.read()

new = src

# 1. JS const block. Three lines, anchored on each const name. Use a function
#    so we don't depend on the URL string being unchanged between runs.
new = re.sub(
    r'const KNOWN_VERSION = "[^"]*";',
    f'const KNOWN_VERSION = "{ver}";',
    new, count=1,
)
new = re.sub(
    r'const KNOWN_INSTALLER = `[^`]*`;',
    f'const KNOWN_INSTALLER = `{inst}`;',
    new, count=1,
)
new = re.sub(
    r'const KNOWN_SIZE_MB = [0-9]+;',
    f'const KNOWN_SIZE_MB = {size};',
    new, count=1,
)

# 2. HTML fallback <span> for hero anchor.
new = re.sub(
    r'(data-i18n="hero\.anchor\.ver">)v[0-9]+\.[0-9]+\.[0-9]+(<)',
    rf'\1v{ver}\2',
    new, count=1,
)
# 3. HTML fallback <span> for dl-meta version row.
new = re.sub(
    r'(id="dl-ver">)v[0-9]+\.[0-9]+\.[0-9]+(<)',
    rf'\1v{ver}\2',
    new, count=1,
)
# 4. i18n dict `hero.anchor.ver` × 2 (en + zh).
new = re.sub(
    r'("hero\.anchor\.ver":\s*)"v[0-9]+\.[0-9]+\.[0-9]+"',
    rf'\1"v{ver}"',
    new,
)

if new == src:
    print("no changes (landing already at v" + ver + ", " + size + " MB)")
    sys.exit(0)

with open(landing, "w", encoding="utf-8") as f:
    f.write(new)
print(f"updated {landing}")
PY

echo
echo "next: review diff, commit, push. landing is static — no rebuild needed."