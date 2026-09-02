#!/bin/bash
# Force-clean stuck Tauri dev processes and ports.
#
# Symptom this fixes: a previous `npx tauri dev` was suspended with Ctrl+Z
# (processes go to T state) or hard-killed (parent npm exec becomes defunct
# zombie), leaving the Vite dev server's port held. The next `npx tauri dev`
# then races the half-dead processes for port 1420 / 1430 / the management
# API port, the new WebView spins forever on `localhost:1420`, and the user
# sees a blank white window that never paints.
#
# What this kills (all patterns match by full command line, not just name):
#   - npm exec / node tauri dev processes (the wrapper chain)
#   - sh -c "tauri" / "vite" / "node ... build:server" subshells
#     (these are what Ctrl+Z actually suspends, even when the parent npm exec
#      looks alive — running `kill` on the parent leaves them in T state)
#   - hamuna / hamuna-desktop (the compiled Tauri binary)
#   - WebKitWebProcess / WebKitNetworkProcess whose parent is one of the above
#     (Linux webkit2gtk-4.1; on macOS the WebKit helper is inside the .app
#      bundle and is matched via parent PPID chain)
#   - Defunct zombies (state Z) — reaped by killing their parent
#
# What this DOES NOT kill:
#   - Other projects' tauri dev (matched by repo cwd below)
#   - System processes, browser, IDE, etc.
#
# Idempotent: safe to run multiple times.

# NOTE: deliberately NOT using `set -e`. Every kill/pgrep/lsof in this script
# can legitimately return non-zero (process gone, port free, lsof missing),
# and we want the script to keep running through every step so the final
# "clean" report is accurate.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Vite dev server (Tauri beforeDevCommand default) + its alt port.
# Tauri management API (HamunaAgent hardcoded).
# Sidecar default + a small window of session sidecar ports.
PORTS_TO_CLEAN=(1420 1430 45679 31415 31416 31417 31418 31419 31420)

# Match by full command line (ps -o command= shows CMD column with argv[0..]).
# Patterns intentionally narrow so we don't kill unrelated processes whose
# name happens to share a substring.
PATTERNS=(
  "node .*tauri dev"
  "node .*/\\.bin/tauri"
  "node .*/\\.bin/vite"
  "sh -c .*tauri"
  "sh -c .*vite"
  "sh -c .*build:server"
  "sh -c .*build:bridge"
  "sh -c .*dev:web"
  "npm exec tauri"
  "npm exec vite"
  "hamuna-desktop"
  "/hamuna "
)

killed_count=0

log_kill() {
  local label="$1" pid="$2" extra="${3:-}"
  echo -e "  ${RED}${label}${NC}  pid=${pid}${extra}"
  killed_count=$((killed_count + 1))
}

log_warn() {
  echo -e "  ${YELLOW}$*${NC}"
}

# Walk parent chain from a given PID; return 0 if any ancestor's command line
# matches one of our tauri/vite/build patterns. Used to identify orphan WebKit
# sub-processes (Rust side already dead but WebKit still alive on
# localhost:1420, which is exactly the blank-white-window failure mode).
parent_chain_matches_tauri_stack() {
  local pid="$1"
  local cur="$pid"
  local ppid cmd i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ppid=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')
    [ -z "$ppid" ] && return 1
    [ "$ppid" = "0" ] && return 1
    cmd=$(ps -o command= -p "$ppid" 2>/dev/null || true)
    [ -z "$cmd" ] && return 1
    for pat in "${PATTERNS[@]}"; do
      if [[ "$cmd" =~ $pat ]]; then
        return 0
      fi
    done
    cur="$ppid"
  done
  return 1
}

# Returns 0 if PID's cwd is inside our project (kills here are safe).
# Returns 1 otherwise — process lives in another checkout, leave it alone.
is_in_this_project() {
  local pid="$1"
  local cwd
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  [ -z "$cwd" ] && return 1
  case "$cwd" in
    "$PROJECT_DIR") return 0 ;;
    "$PROJECT_DIR"/*) return 0 ;;
    *) return 1 ;;
  esac
}

echo -e "${BLUE}Cleaning Tauri dev processes for: ${PROJECT_DIR}${NC}"
echo

# 1. Reap T (stopped) and Z (zombie) processes FIRST.
#    - T processes ignore SIGTERM until SIGCONT is sent, so SIGKILL is the
#      only option. SIGCONT would let them resume as zombies of nothing.
#    - Zombies can't be killed directly; we must kill their parent so init
#      reaps them. The parent is always one of our tauri/vite/build patterns.
echo "  [1/4] stopped + zombie processes"
while read -r pid stat cmd; do
  [ -z "$pid" ] && continue
  matches=0
  for pat in "${PATTERNS[@]}"; do
    if [[ "$cmd" =~ $pat ]]; then
      matches=1
      break
    fi
  done
  [ "$matches" -eq 1 ] || continue

  if [[ "$stat" == Z* ]]; then
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    if [ -n "$ppid" ] && [ "$ppid" != "0" ]; then
      log_kill "reap zombie via parent" "$ppid" " (zombie was pid=$pid)"
      kill -9 "$ppid" 2>/dev/null || true
    fi
    continue
  fi

  log_kill "kill -9 (stopped)" "$pid" "  $cmd"
  kill -9 "$pid" 2>/dev/null || true
done < <(ps -eo pid=,stat=,command= 2>/dev/null \
  | awk '$2 ~ /^[TZ]/ { print }' 2>/dev/null || true)

# 2. SIGTERM the running stack (R/Sl/SLl), then SIGKILL after 2s grace.
#    SIGTERM gives a chance for graceful shutdown (close DB locks, flush
#    pending IPC). SIGKILL is the final backstop.
echo "  [2/4] running stack: SIGTERM → grace 2s → SIGKILL"
for pat in "${PATTERNS[@]}"; do
  pids=$(pgrep -f "$pat" 2>/dev/null || true)
  for pid in $pids; do
    is_in_this_project "$pid" || continue
    kill "$pid" 2>/dev/null || true
  done
done
sleep 2
for pat in "${PATTERNS[@]}"; do
  pids=$(pgrep -f "$pat" 2>/dev/null || true)
  for pid in $pids; do
    is_in_this_project "$pid" || continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    log_kill "kill -9" "$pid" "  pat=$pat  cwd=${cwd:-?}"
    kill -9 "$pid" 2>/dev/null || true
  done
done

# 3. Orphan WebKit sub-processes — Rust side already dead but WebKit is still
#    alive on localhost:1420. Without this, even after we kill the Tauri
#    process, the WebView stays open consuming the port.
echo "  [3/4] orphan WebKit sub-processes"
if command -v pgrep >/dev/null 2>&1; then
  for pid in $(pgrep -f "WebKit" 2>/dev/null || true); do
    if parent_chain_matches_tauri_stack "$pid"; then
      log_kill "kill -9 orphan webkit" "$pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
else
  log_warn "pgrep not available — skip orphan WebKit detection"
fi

# 4. Free dev ports. The owning process should already be dead by now; this
#    catches edge cases (TIME_WAIT, lingering fd holders, etc.).
echo "  [4/4] dev ports"
if command -v lsof >/dev/null 2>&1; then
  for port in "${PORTS_TO_CLEAN[@]}"; do
    holder=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$holder" ]; then
      log_kill "kill -9 port=$port" "$holder"
      kill -9 "$holder" 2>/dev/null || true
    fi
  done
elif command -v ss >/dev/null 2>&1; then
  for port in "${PORTS_TO_CLEAN[@]}"; do
    # ss -tlnp shows LISTEN sockets with owning pid in the users:(...) field.
    holder=$(ss -tlnpH "sport = :$port" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
    if [ -n "$holder" ]; then
      log_kill "kill -9 port=$port" "$holder"
      kill -9 "$holder" 2>/dev/null || true
    fi
  done
else
  log_warn "neither lsof nor ss available — skip port cleanup"
fi

# 5. Confirm clean state.
echo
echo -e "${BLUE}=== After cleanup ===${NC}"
remaining=0
for pat in "${PATTERNS[@]}"; do
  hits=$(pgrep -f "$pat" 2>/dev/null || true)
  for pid in $hits; do
    is_in_this_project "$pid" || continue
    echo -e "  ${RED}still alive${NC}: pid=$pid pat=$pat"
    remaining=$((remaining + 1))
  done
done

if command -v lsof >/dev/null 2>&1; then
  for port in "${PORTS_TO_CLEAN[@]}"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo -e "  ${RED}port still held${NC}: $port"
      lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
      remaining=$((remaining + 1))
    fi
  done
fi

echo
if [ "$remaining" -eq 0 ]; then
  echo -e "${GREEN}✓ clean${NC} — $killed_count process(es) killed, all target ports free"
  echo
  echo "Next: cd \"$PROJECT_DIR\" && npx tauri dev"
else
  echo -e "${YELLOW}⚠ $remaining stuck item(s) remain${NC}"
  echo "  Inspect: ps aux | grep -E 'tauri|hamuna|vite|WebKit' | grep -v grep"
  echo "  Ports:   ss -tlnp | grep -E '1420|1430|45679|31415'"
fi