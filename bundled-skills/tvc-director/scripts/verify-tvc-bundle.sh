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
# v0.8 changes:
#   - §12.6 expanded: add `reference_tags` to required v0.8 panel field check
#   - §12.9 added: runtime lint — accepts --storyboard/--video envelope paths,
#     runs 6 real checks (cross-segment visual_style_anchor / character_setup
#     consistency + per-panel shot_type / character_emotion / sound_effect
#     presence in segment prompt + mapping panel coverage).
#     Skipped with WARN when CLI args absent (CI default).
#   - §12.10 added: self-check 4 checks (qc.md documents 3 new global redlines /
#     schema §10 global_redlines_status contains 3 new keys).

# v0.7 changes:
#   - §12.6 expanded: add `references` to required v0.7 field check (block-level reference list)
#   - §12.8 added: 3 v0.7 block-reference consumption checks
#     (video-prompt.md consumes blocks[].references[] / cheatsheet §4.3 has two-layer model /
#      asset-storyboard.md has Per-Block Reference Decision section)

# v0.6 changes:
#   - §12.7 added: 7 v0.5→video handoff contract checks
#     (video-prompt.md must explicitly list visual_style_anchor / character_setup /
#      shot_type / character_emotion / sound_effect / grid_path;
#      step-output-schema.md §9 storyboard_to_clip_mapping must reference panels[].panel_id)
#   - SKILL §15.6 handoff contract added
#   - cheatsheet §4.6 added 3 v0.5→video reverse-drift anti-patterns

# v0.5 changes:
#   - §11 expected_h3["§4. 故事板图"] updated to 6 new H3 titles
#     (4.1 Mandatory / 4.2 Layout 类型与决策（6 类） / 4.3 参考图输入 + 固定人设 /
#      4.4 段落分镜自适应网格算法 / 4.5 摄影 + 视觉风格 / 4.6 反模式)
#   - §12.6 added: 6 field checks for storyboard_grid v0.5 schema
#     (layout_type / visual_style_anchor / character_setup / shot_type / character_emotion / sound_effect)

# v0.4 changes:
#   - §8 workflow step count: 10 → 11 (added Step 0 pre-step tvc-agent-script)
#   - §12 ALLOWED_KINDS: added `script` (now 11 kinds total)
#   - §12.4 schema section check: added `script` section (was §1-§10, now §1-§11)
#   - §12.5 routing table check: §11 → §12 (widget routing was §11, now §12 after script section inserted)
#   - §2 agent count: 10 → 11
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
if [[ "${AGENT_COUNT}" -eq 11 ]]; then
  ok "agents count = 11"
else
  bad "agents count expected 11, got ${AGENT_COUNT}"
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
if [[ "${WORKFLOW_COUNT}" -eq 11 ]]; then
  ok "workflow step count = 11 (added Step 0 tvc-agent-script pre-step)"
else
  bad "workflow step count expected 11, got ${WORKFLOW_COUNT}"
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
if [[ "${REF_COUNT}" -eq 25 ]]; then
  ok "references/ contains 25 markdown files"
else
  warn "references/ contains ${REF_COUNT} markdown files (expected 25 — including asset-prompting-cheatsheet.md + step-output-schema.md)"
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
    ["§4. 故事板图"]="4.1 Mandatory — 何时必生成|4.2 Layout 类型与决策（6 类 — v0.5 升级）|4.3 参考图输入与固定人设|4.4 段落分镜自适应网格算法|4.5 摄影与视觉风格（跟 selected_style）|4.6 反模式（自动 reject）"
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

# --- 12. step-output-schema consistency (v0.3+) -------------------------------
section "12. step-output-schema consistency (v0.3+)"

# Whitelist of allowed artifact_kind values (must match references/step-output-schema.md §1-§11)
ALLOWED_KINDS="script brief routes shot_plan storyboard_grid voiceover_list product_action_chain flavor_plan packshot_module video_prompts qc_report"

# 12.1 every agent must declare artifact_kind (11 checks)
declare -A declared_kinds=()
for skill_id in "${DECLARED_AGENTS[@]}"; do
  kind=$(jq -r ".agents[] | select(.skill_id == \"${skill_id}\") | .artifact_kind" "${CAPS_FILE}")
  if [[ -z "${kind}" || "${kind}" == "null" ]]; then
    bad "${skill_id}: missing artifact_kind"
    continue
  fi
  if [[ " ${ALLOWED_KINDS} " != *" ${kind} "* ]]; then
    bad "${skill_id}: artifact_kind '${kind}' not in whitelist (${ALLOWED_KINDS})"
    continue
  fi
  declared_kinds["${skill_id}"]="${kind}"
  ok "${skill_id}: artifact_kind = '${kind}'"
done

# 12.2 artifact_kinds must be unique (1 check)
unique_kinds=$(printf '%s\n' "${declared_kinds[@]}" | sort -u | wc -l | tr -d ' ')
total_kinds=${#declared_kinds[@]}
if [[ "${unique_kinds}" -eq "${total_kinds}" && "${total_kinds}" -eq 11 ]]; then
  ok "all 11 artifact_kinds are unique"
else
  bad "artifact_kinds not unique: ${unique_kinds} unique vs ${total_kinds} declared (expected 11)"
fi

# 12.3 every agent's Workflow Context must contain '**Artifact kind**' + '**Schema reference**' (10+10 = 20 checks)
for skill_id in "${DECLARED_AGENTS[@]}"; do
  internal_path=$(jq -r ".agents[] | select(.skill_id == \"${skill_id}\") | .internal_path" "${CAPS_FILE}")
  full="${BUNDLE_ROOT}/${internal_path}"
  [[ -f "${full}" ]] || continue
  if grep -q '\*\*Artifact kind\*\*:' "${full}"; then
    ok "${skill_id}: Workflow Context has **Artifact kind** sub-key"
  else
    bad "${skill_id}: Workflow Context missing **Artifact kind** sub-key"
  fi
  if grep -q '\*\*Schema reference\*\*:' "${full}"; then
    ok "${skill_id}: Workflow Context has **Schema reference** sub-key"
  else
    bad "${skill_id}: Workflow Context missing **Schema reference** sub-key"
  fi
done

# 12.4 step-output-schema.md exists and has 11 §X. artifact sections (12 checks: 1 file + 11 sections)
SCHEMA_DOC="${BUNDLE_ROOT}/references/step-output-schema.md"
if [[ ! -f "${SCHEMA_DOC}" ]]; then
  bad "step-output-schema.md not found at ${SCHEMA_DOC}"
else
  ok "step-output-schema.md exists"
  for n in 1 2 3 4 5 6 7 8 9 10 11; do
    if grep -qE "^## §${n}\." "${SCHEMA_DOC}"; then
      ok "step-output-schema.md has §${n}. artifact section"
    else
      bad "step-output-schema.md missing §${n}. artifact section"
    fi
  done
fi

# 12.5 step-output-schema.md has §12 widget routing table (1 check)
if grep -qE "^## §12\." "${SCHEMA_DOC}"; then
  ok "step-output-schema.md has §12 Widget Routing Table"
else
  bad "step-output-schema.md missing §12 Widget Routing Table"
fi

# 12.6 storyboard_grid artifact v0.5 fields (§4 must contain required fields — 6 checks; v0.7 +1 check)
section_4=$(sed -n '/^## §4\./,/^## §5\./p' "${SCHEMA_DOC}")
required_v05_fields=("layout_type" "visual_style_anchor" "character_setup" "shot_type" "character_emotion" "sound_effect")
for f in "${required_v05_fields[@]}"; do
  if echo "${section_4}" | grep -q "\b${f}\b"; then
    ok "§4 contains v0.5 field: ${f}"
  else
    bad "§4 missing v0.5 field: ${f}"
  fi
done
# v0.7: block-level references[] required field
if echo "${section_4}" | grep -qE "blocks\[\]\.references\[\]"; then
  ok "§4 contains v0.7 field: blocks[].references[]"
else
  bad "§4 missing v0.7 field: blocks[].references[]"
fi
# v0.8: panel-level reference_tags[] required field
if echo "${section_4}" | grep -qE "reference_tags\[\]"; then
  ok "§4 contains v0.8 field: panels[].reference_tags[]"
else
  bad "§4 missing v0.8 field: panels[].reference_tags[]"
fi

# 12.7 v0.5 → video handoff contract (Step 4 storyboard → Step 9 video-prompt — 7 checks)
VIDEO_PROMPT="${BUNDLE_ROOT}/agents/video-prompt.md"
required_handoff_fields=("visual_style_anchor" "character_setup" "shot_type" "character_emotion" "sound_effect" "grid_path")
for f in "${required_handoff_fields[@]}"; do
  if grep -q "\b${f}\b" "${VIDEO_PROMPT}"; then
    ok "video-prompt.md consumes v0.5 field: ${f}"
  else
    bad "video-prompt.md missing v0.5 field consumption: ${f}"
  fi
done

# step-output-schema §9 storyboard_to_clip_mapping must reference panels[].panel_id source
section_9=$(sed -n '/^## §9\./,/^## §10\./p' "${SCHEMA_DOC}")
if echo "${section_9}" | grep -qF "panels[].panel_id"; then
  ok "§9 storyboard_to_clip_mapping derives panel_ids from panels[].panel_id"
else
  bad "§9 storyboard_to_clip_mapping missing panels[].panel_id source reference"
fi

# 12.8 v0.7 per-block reference consumption (3 checks)
# video-prompt.md must consume blocks[].references[] for segment reference_images[]
if grep -qF "blocks[].references[]" "${VIDEO_PROMPT}"; then
  ok "video-prompt.md consumes v0.7 blocks[].references[]"
else
  bad "video-prompt.md missing v0.7 blocks[].references[] consumption"
fi
# cheatsheet §4.3 must contain the two-layer model marker
CHEATSHEET="${BUNDLE_ROOT}/references/asset-prompting-cheatsheet.md"
section_43=$(sed -n '/^### 4\.3 /,/^### 4\.4 /p' "${CHEATSHEET}")
if echo "${section_43}" | grep -qE "Envelope 顶层"; then
  ok "cheatsheet §4.3 documents two-layer model (envelope top + block level)"
else
  bad "cheatsheet §4.3 missing two-layer model documentation"
fi
# asset-storyboard.md must contain Per-Block Reference Decision section
ASSET_STORYBOARD="${BUNDLE_ROOT}/agents/asset-storyboard.md"
if grep -qE "Per-Block Reference Decision" "${ASSET_STORYBOARD}"; then
  ok "asset-storyboard.md has Per-Block Reference Decision section"
else
  bad "asset-storyboard.md missing Per-Block Reference Decision section"
fi

# 12.9 v0.8 runtime lint — only runs when both --storyboard and --video envelopes are provided.
# CI default: no args → SKIP + WARN (real-run envelopes live in workspace/<project>/, not repo).
STORYBOARD_ENV=""
VIDEO_ENV=""
for arg in "$@"; do
  case "$arg" in
    --storyboard=*) STORYBOARD_ENV="${arg#*=}" ;;
    --video=*)      VIDEO_ENV="${arg#*=}"      ;;
  esac
done
if [[ -n "${STORYBOARD_ENV}" && -n "${VIDEO_ENV}" ]]; then
  if [[ ! -f "${STORYBOARD_ENV}" ]]; then bad "§12.9 --storyboard file not found: ${STORYBOARD_ENV}"; exit 1; fi
  if [[ ! -f "${VIDEO_ENV}"      ]]; then bad "§12.9 --video file not found: ${VIDEO_ENV}";       exit 1; fi

  # Real-run check 1: every block's visual_style_anchor appears in some segment.prompt (cross-segment consistency)
  mapfile -t ANCHORS < <(jq -r '.artifact.blocks[].visual_style_anchor // empty' "${STORYBOARD_ENV}")
  mapfile -t SEG_PROMPTS < <(jq -r '.artifact.segments[].prompt // empty' "${VIDEO_ENV}")
  for anchor in "${ANCHORS[@]}"; do
    [[ -z "$anchor" ]] && continue
    found=0
    for prompt in "${SEG_PROMPTS[@]}"; do
      [[ "$prompt" == *"$anchor"* ]] && found=1 && break
    done
    if [[ "$found" -eq 1 ]]; then
      ok "§12.9 visual_style_anchor \"$anchor\" found in segment prompts"
    else
      bad "§12.9 visual_style_anchor \"$anchor\" NOT found in any segment prompt (cross-segment drift)"
    fi
  done

  # Real-run check 2: every block's character_setup (non-"none") appears in some segment.prompt
  mapfile -t CHAR_SETUPS < <(jq -r '.artifact.blocks[].character_setup // empty' "${STORYBOARD_ENV}")
  for cs in "${CHAR_SETUPS[@]}"; do
    [[ -z "$cs" || "$cs" == "none" ]] && continue
    found=0
    for prompt in "${SEG_PROMPTS[@]}"; do
      [[ "$prompt" == *"$cs"* ]] && found=1 && break
    done
    if [[ "$found" -eq 1 ]]; then
      ok "§12.9 character_setup copied into segment prompts"
    else
      bad "§12.9 character_setup \"${cs:0:40}...\" NOT found in any segment prompt (drift)"
    fi
  done

  # Real-run check 3: each panel's shot_type appears in at least one segment.prompt
  mapfile -t SHOT_TYPES < <(jq -r '.artifact.blocks[].panels[].shot_type // empty' "${STORYBOARD_ENV}")
  for st in "${SHOT_TYPES[@]}"; do
    [[ -z "$st" ]] && continue
    found=0
    for prompt in "${SEG_PROMPTS[@]}"; do
      [[ "$prompt" == *"$st"* ]] && found=1 && break
    done
    if [[ "$found" -eq 1 ]]; then
      ok "§12.9 shot_type \"$st\" found in segment prompts"
    else
      bad "§12.9 shot_type \"$st\" NOT found in any segment prompt"
    fi
  done

  # Real-run check 4: each panel's non-empty character_emotion appears in at least one segment.prompt
  mapfile -t EMOTIONS < <(jq -r '.artifact.blocks[].panels[].character_emotion // empty' "${STORYBOARD_ENV}")
  for em in "${EMOTIONS[@]}"; do
    [[ -z "$em" ]] && continue
    found=0
    for prompt in "${SEG_PROMPTS[@]}"; do
      [[ "$prompt" == *"$em"* ]] && found=1 && break
    done
    if [[ "$found" -eq 1 ]]; then
      ok "§12.9 character_emotion \"$em\" found in segment prompts"
    else
      bad "§12.9 character_emotion \"$em\" NOT found in any segment prompt"
    fi
  done

  # Real-run check 5: each panel's sound_effect appears in at least one segment.prompt
  mapfile -t SOUND_FX < <(jq -r '.artifact.blocks[].panels[].sound_effect // empty' "${STORYBOARD_ENV}")
  for sf in "${SOUND_FX[@]}"; do
    [[ -z "$sf" ]] && continue
    found=0
    for prompt in "${SEG_PROMPTS[@]}"; do
      [[ "$prompt" == *"$sf"* ]] && found=1 && break
    done
    if [[ "$found" -eq 1 ]]; then
      ok "§12.9 sound_effect \"$sf\" found in segment prompts"
    else
      bad "§12.9 sound_effect \"$sf\" NOT found in any segment prompt"
    fi
  done

  # Real-run check 6: storyboard_to_clip_mapping panel_ids cover all storyboard panel_ids (no missing, no dup)
  MAPPING_PANELS=$(jq -r '.artifact.storyboard_to_clip_mapping[].panel_ids[]? // empty' "${VIDEO_ENV}" | sort -u | wc -l)
  MAPPING_PANELS_DUP=$(jq -r '.artifact.storyboard_to_clip_mapping[].panel_ids[]? // empty' "${VIDEO_ENV}" | sort | uniq -d | wc -l)
  STORYBOARD_PANELS=$(jq -r '.artifact.blocks[].panels[].panel_id // empty' "${STORYBOARD_ENV}" | sort -u | wc -l)
  if [[ "${MAPPING_PANELS}" -eq "${STORYBOARD_PANELS}" && "${MAPPING_PANELS_DUP}" -eq 0 ]]; then
    ok "§12.9 storyboard_to_clip_mapping covers all ${STORYBOARD_PANELS} panel_ids (no missing, no dup)"
  else
    bad "§12.9 mapping coverage: ${MAPPING_PANELS}/${STORYBOARD_PANELS} panel_ids, ${MAPPING_PANELS_DUP} duplicates"
  fi
else
  warn "§12.9 runtime lint SKIPPED (no --storyboard/--video envelopes provided; CI default)"
fi

# 12.10 v0.8 Step 10 QC self-check (6 checks: 3 in qc.md + 3 in step-output-schema §10).
# Three new global redlines added in v0.8:
#   - character_setup_consistency (cross-block Character Lock 字面值一致性)
#   - visual_style_anchor_consistency (跨 segment 同一 anchor)
#   - panel_id_unique (panel_id 全集去重 + 覆盖 storyboard 全集)
QC_FILE="${BUNDLE_ROOT}/agents/qc.md"
SCHEMA_FILE="${BUNDLE_ROOT}/references/step-output-schema.md"
section_10=$(sed -n '/^## §10\.\|^### 10\.\|^## 10\.\|^### §10\./,/^## §1[1-9]\.\|^### 1[1-9]\./p' "${SCHEMA_FILE}")
if [[ -z "${section_10}" ]]; then
  # fallback: locate §10 by header pattern, take next 80 lines
  section_10=$(awk '/^## §10\.|^### 10\.|^## 10\./{flag=1} flag{print; n++; if(n>80) exit}' "${SCHEMA_FILE}")
fi
for KEY in character_setup_consistency visual_style_anchor_consistency panel_id_unique; do
  if grep -qF "${KEY}" "${QC_FILE}"; then
    ok "qc.md documents v0.8 global redline: ${KEY}"
  else
    bad "qc.md missing v0.8 global redline: ${KEY}"
  fi
  if echo "${section_10}" | grep -qF "${KEY}"; then
    ok "step-output-schema §10 declares v0.8 global_redlines_status.${KEY}"
  else
    bad "step-output-schema §10 missing global_redlines_status.${KEY}"
  fi
done

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