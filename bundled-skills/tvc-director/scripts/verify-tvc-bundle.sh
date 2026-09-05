#!/usr/bin/env bash
# verify-tvc-bundle.sh
# Validate the tvc-director bundle contract: agent-capabilities.json must agree
# with the on-disk 10 tvc-agent-* skills, 6 tvc-style-* skills, and reachable
# references/. Run from anywhere; auto-detects the bundle root by walking up to
# the directory that contains agent-capabilities.json.
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed
#   2  bundle root not found (not running inside tvc-director/)
#
# v0.3 changes:
#   - §3/§5/§5b/§7 use `internal_path` (flat .md under agents/ and styles/) instead
#     of legacy `../<skill_id>/SKILL.md`
#   - §4 frontmatter check removed (files are flat .md without frontmatter)
#   - §10 expects 24 reference files (added asset-prompting-cheatsheet.md)
#   - §11 added: 36-item cheatsheet integrity check (4 H2 chapters × 6 H3 sub-sections
#     + 4 cross-links + 4 agent pre-gen confirmation sections)

set -euo pipefail

# --- locate bundle root ------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ! -f "${BUNDLE_ROOT}/agent-capabilities.json" ]]; then
  echo "ERROR: agent-capabilities.json not found at ${BUNDLE_ROOT}" >&2
  exit 2
fi

CAPS_FILE="${BUNDLE_ROOT}/agent-capabilities.json"

# --- prerequisites -----------------------------------------------------------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' not found in PATH" >&2
    exit 2
  fi
}
require_cmd jq

# --- counters ----------------------------------------------------------------
PASS=0
FAIL=0
WARN=0

ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN] $1"; WARN=$((WARN+1)); }

section() { echo; echo "=== $1 ==="; }

# --- 1. JSON validity --------------------------------------------------------
section "1. agent-capabilities.json validity"
if jq -e . "${CAPS_FILE}" >/dev/null 2>&1; then
  ok "valid JSON"
else
  bad "agent-capabilities.json is not valid JSON"
  exit 1
fi

VERSION=$(jq -r '.contract_version' "${CAPS_FILE}")
if [[ "${VERSION}" == "1" ]]; then
  ok "contract_version = 1"
else
  bad "contract_version expected '1', got '${VERSION}'"
fi

# --- 2. agents array integrity ----------------------------------------------
section "2. agents array integrity"
AGENT_COUNT=$(jq '.agents | length' "${CAPS_FILE}")
if [[ "${AGENT_COUNT}" -eq 10 ]]; then
  ok "agents count = 10"
else
  bad "agents count expected 10, got ${AGENT_COUNT}"
fi

# --- 3. agent file existence via internal_path -------------------------------
section "3. agent file existence via internal_path"
mapfile -t DECLARED_AGENTS < <(jq -r '.agents[].skill_id' "${CAPS_FILE}")
for skill_id in "${DECLARED_AGENTS[@]}"; do
  internal_path=$(jq -r ".agents[] | select(.skill_id == \"${skill_id}\") | .internal_path" "${CAPS_FILE}")
  if [[ -z "${internal_path}" || "${internal_path}" == "null" ]]; then
    bad "${skill_id}: missing internal_path"
    continue
  fi
  full="${BUNDLE_ROOT}/${internal_path}"
  if [[ -f "${full}" ]]; then
    ok "${skill_id} -> ${internal_path}"
  else
    bad "${skill_id}: file not found at ${full}"
  fi
done

# --- 4. (removed) frontmatter check -----------------------------------------
section "4. (removed) agent file format check"
ok "skipped (files are flat .md without frontmatter — see v0.3 schema)"

# --- 5. agent required sections present --------------------------------------
section "5. agent required sections (Purpose / Inputs / Do Not / Workflow Context)"
for skill_id in "${DECLARED_AGENTS[@]}"; do
  internal_path=$(jq -r ".agents[] | select(.skill_id == \"${skill_id}\") | .internal_path" "${CAPS_FILE}")
  full="${BUNDLE_ROOT}/${internal_path}"
  [[ -f "${full}" ]] || continue
  missing=()
  grep -q '^# Purpose'        "${full}" || missing+=("Purpose")
  grep -q '^# Inputs'          "${full}" || missing+=("Inputs")
  grep -q '^# Do Not'          "${full}" || missing+=("Do Not")
  grep -q '^## Workflow Context' "${full}" || missing+=("Workflow Context")
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "${skill_id}: has Purpose + Inputs + Do Not + Workflow Context"
  else
    bad "${skill_id}: missing sections: ${missing[*]}"
  fi
done

# --- 5b. Workflow Context required sub-keys ----------------------------------
section "5b. Workflow Context required sub-keys (Step / Gate / State envelope)"
for skill_id in "${DECLARED_AGENTS[@]}"; do
  internal_path=$(jq -r ".agents[] | select(.skill_id == \"${skill_id}\") | .internal_path" "${CAPS_FILE}")
  full="${BUNDLE_ROOT}/${internal_path}"
  [[ -f "${full}" ]] || continue
  if ! grep -q '^## Workflow Context' "${full}"; then
    continue
  fi
  wc_block=$(sed -n '/^## Workflow Context/,$p' "${full}")
  missing=()
  echo "${wc_block}" | grep -q '\*\*Step\*\*:'            || missing+=("Step")
  echo "${wc_block}" | grep -q '\*\*Gate\*\*:'             || missing+=("Gate")
  echo "${wc_block}" | grep -q '\*\*State envelope\*\*:'   || missing+=("State envelope")
  echo "${wc_block}" | grep -q '\*\*On failure\*\*:'       || missing+=("On failure")
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "${skill_id}: Workflow Context has Step / Gate / State envelope / On failure"
  else
    bad "${skill_id}: Workflow Context missing sub-keys: ${missing[*]}"
  fi
done

# --- 6. references_on_demand reachability ------------------------------------
section "6. references_on_demand reachability"
for skill_id in "${DECLARED_AGENTS[@]}"; do
  refs=$(jq -r ".agents[] | select(.skill_id == \"${skill_id}\") | .references_on_demand[]?" "${CAPS_FILE}")
  while IFS= read -r ref; do
    [[ -z "${ref}" ]] && continue
    # ref paths look like "tvc-director/references/foo.md"
    rel="${ref#tvc-director/}"
    full="${BUNDLE_ROOT}/${rel}"
    if [[ -f "${full}" ]]; then
      ok "${skill_id}: reference reachable -> ${ref}"
    else
      bad "${skill_id}: reference NOT reachable -> ${ref} (expected at ${full})"
    fi
  done <<< "${refs}"
done

# --- 7. styles array integrity -----------------------------------------------
section "7. styles array integrity"
STYLE_COUNT=$(jq '.styles | length' "${CAPS_FILE}")
if [[ "${STYLE_COUNT}" -eq 6 ]]; then
  ok "styles count = 6"
else
  bad "styles count expected 6, got ${STYLE_COUNT}"
fi

mapfile -t DECLARED_STYLES < <(jq -r '.styles[].skill_id' "${CAPS_FILE}")
for style_id in "${DECLARED_STYLES[@]}"; do
  internal_path=$(jq -r ".styles[] | select(.skill_id == \"${style_id}\") | .internal_path" "${CAPS_FILE}")
  if [[ -z "${internal_path}" || "${internal_path}" == "null" ]]; then
    bad "${style_id}: missing internal_path"
    continue
  fi
  full="${BUNDLE_ROOT}/${internal_path}"
  if [[ -f "${full}" ]]; then
    ok "${style_id} -> ${internal_path}"
  else
    bad "${style_id}: file not found at ${full}"
  fi
done

# --- 8. workflow array integrity ---------------------------------------------
section "8. workflow array integrity"
WORKFLOW_COUNT=$(jq '.workflow | length' "${CAPS_FILE}")
if [[ "${WORKFLOW_COUNT}" -eq 10 ]]; then
  ok "workflow step count = 10"
else
  bad "workflow step count expected 10, got ${WORKFLOW_COUNT}"
fi

# unique step numbers and unique agent ids
WORKFLOW_STEPS=$(jq -r '.workflow[].step' "${CAPS_FILE}" | sort -n | uniq -d)
if [[ -z "${WORKFLOW_STEPS}" ]]; then
  ok "workflow step numbers unique"
else
  bad "workflow has duplicate step numbers: ${WORKFLOW_STEPS}"
fi

WORKFLOW_AGENTS=$(jq -r '.workflow[].agent' "${CAPS_FILE}" | sort | uniq -d)
if [[ -z "${WORKFLOW_AGENTS}" ]]; then
  ok "workflow agent ids unique"
else
  bad "workflow has duplicate agent ids: ${WORKFLOW_AGENTS}"
fi

# every workflow agent must exist in agents array
WORKFLOW_AGENT_LIST=$(jq -r '.workflow[].agent' "${CAPS_FILE}" | sort -u)
AGENT_LIST=$(jq -r '.agents[].skill_id' "${CAPS_FILE}" | sort -u)
if diff <(echo "${WORKFLOW_AGENT_LIST}") <(echo "${AGENT_LIST}") >/dev/null; then
  ok "workflow agent set matches agents array"
else
  bad "workflow agent set differs from agents array"
  diff <(echo "${WORKFLOW_AGENT_LIST}") <(echo "${AGENT_LIST}") | sed 's/^/    /'
fi

# Step 9 gate must be strong (v0.3 upgrade)
STEP9_GATE=$(jq -r '.workflow[] | select(.step == 9) | .gate' "${CAPS_FILE}")
if [[ "${STEP9_GATE}" == "strong" ]]; then
  ok "Step 9 gate is strong (v0.3 upgrade)"
else
  bad "Step 9 gate expected 'strong', got '${STEP9_GATE}'"
fi

# --- 9. global_redlines present ----------------------------------------------
section "9. global_redlines"
REDLINE_COUNT=$(jq '.global_redlines | length' "${CAPS_FILE}")
if [[ "${REDLINE_COUNT}" -ge 3 ]]; then
  ok "global_redlines count = ${REDLINE_COUNT}"
else
  warn "global_redlines count is ${REDLINE_COUNT} (expected >= 3)"
fi

# --- 10. references/ directory integrity ------------------------------------
section "10. references/ directory"
REF_COUNT=$(find "${BUNDLE_ROOT}/references" -name "*.md" -type f | wc -l | tr -d ' ')
if [[ "${REF_COUNT}" -eq 24 ]]; then
  ok "references/ contains 24 markdown files"
else
  warn "references/ contains ${REF_COUNT} markdown files (expected 24 — including asset-prompting-cheatsheet.md)"
fi

# --- 11. cheatsheet integrity (36-item check: 4 H2 + 24 H3 + 4 cross-link + 4 agent pre-gen) ---
section "11. asset-prompting-cheatsheet integrity (36 items)"
CHEATSHEET="${BUNDLE_ROOT}/references/asset-prompting-cheatsheet.md"
if [[ ! -f "${CHEATSHEET}" ]]; then
  bad "cheatsheet file missing at ${CHEATSHEET}"
else
  # 4 H2 chapters present (4 items)
  chapters=(
    "§1. 产品多角度资产图"
    "§2. 短片主角三视图"
    "§3. 场景图片"
    "§4. 故事板图"
  )
  for ch in "${chapters[@]}"; do
    if grep -q "^## ${ch}" "${CHEATSHEET}"; then
      ok "cheatsheet has chapter: ${ch}"
    else
      bad "cheatsheet missing chapter: ${ch}"
    fi
  done

  # 24 H3 sub-sections present (4 chapters × 6 H3 each)
  declare -A expected_h3=(
    ["§1. 产品多角度资产图"]="1.1 Mandatory|1.2 参考图输入|1.3 Prompt Template|1.4 必生成角度清单|1.5 光照|1.6 反模式"
    ["§2. 短片主角三视图"]="2.1 Mandatory|2.2 参考图输入|2.3 Prompt Template|2.4 三视图分版|2.5 光照|2.6 反模式"
    ["§3. 场景图片"]="3.1 Mandatory|3.2 参考图输入|3.3 Prompt Template|3.4 必生成场景清单|3.5 光照|3.6 反模式"
    ["§4. 故事板图"]="4.1 Mandatory|4.2 参考图输入|4.3 Prompt Template|4.4 段落分镜自适应网格算法|4.5 摄影|4.6 反模式"
  )
  for ch in "${chapters[@]}"; do
    IFS='|' read -ra h3_list <<< "${expected_h3[$ch]}"
    for h3 in "${h3_list[@]}"; do
      # H3 may be followed by space + suffix (e.g. "### 1.6 反模式（自动 reject）")
      # so match either end-of-line OR any non-newline suffix starting with space
      if grep -qE "^### ${h3}( |（|$)" "${CHEATSHEET}"; then
        ok "cheatsheet ${ch} has H3: ${h3}"
      else
        bad "cheatsheet ${ch} missing H3: ${h3}"
      fi
    done
  done

  # 4 reference files cross-link cheatsheet (asset-standards / agnes-prompting / product-image-anchor / storyboard-style)
  reference_files=(
    "references/pre-production/asset-standards.md"
    "references/agnes-prompting.md"
    "references/pre-production/product-image-anchor.md"
    "references/pre-production/storyboard-style.md"
  )
  for rf in "${reference_files[@]}"; do
    full="${BUNDLE_ROOT}/${rf}"
    if grep -q 'asset-prompting-cheatsheet' "${full}"; then
      ok "reference ${rf} cross-links cheatsheet"
    else
      bad "reference ${rf} missing cheatsheet cross-link"
    fi
  done

  # 4 agent pre-gen confirmation sections (asset-storyboard, voiceover, video-prompt, product-action)
  pregen_agents=(asset-storyboard voiceover video-prompt product-action)
  for a in "${pregen_agents[@]}"; do
    full="${BUNDLE_ROOT}/agents/${a}.md"
    if grep -q '^# Pre-Generation Confirmation Gate' "${full}"; then
      ok "agent ${a}.md has Pre-Generation Confirmation Gate section"
    else
      bad "agent ${a}.md missing Pre-Generation Confirmation Gate section"
    fi
  done
fi

# --- summary ------------------------------------------------------------------
section "SUMMARY"
echo "PASS: ${PASS}"
echo "FAIL: ${FAIL}"
echo "WARN: ${WARN}"

if [[ "${FAIL}" -gt 0 ]]; then
  echo
  echo "Bundle verification FAILED with ${FAIL} error(s)."
  exit 1
fi

echo
echo "Bundle verification passed."
exit 0