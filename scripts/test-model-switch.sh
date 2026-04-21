#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# test-model-switch.sh
# 模型切換驗證（Phase 1）
#  1) 三個 profile 功能測試
#  2) current symlink 一致性驗證
#  3) 穩定性測試（E2B <-> E4B 連續切換）
###############################################################################

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${PROJECT_DIR}/models"
SWITCH_SH="${PROJECT_DIR}/scripts/switch-model.sh"
LOG_FILE="${PROJECT_DIR}/logs/model-switch-test.log"
mkdir -p "${PROJECT_DIR}/logs"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "[%s] %s\n" "${ts}" "$*" | tee -a "${LOG_FILE}"
}

run_switch() {
  local model="$1"
  log "switch -> ${model}"
  bash "${SWITCH_SH}" --model "${model}"
}

assert_health() {
  curl -sf --max-time 4 "http://localhost:8080/health" >/dev/null
  curl -sf --max-time 4 "http://localhost:8000/api/health" >/dev/null
}

assert_current_pair_consistent() {
  local model_link mmproj_link model_real mmproj_real model_dir mmproj_dir
  model_link="${MODELS_DIR}/current/model.gguf"
  mmproj_link="${MODELS_DIR}/current/mmproj.gguf"

  [[ -L "${model_link}" ]] || { log "current/model.gguf 非 symlink"; exit 1; }
  [[ -L "${mmproj_link}" ]] || { log "current/mmproj.gguf 非 symlink"; exit 1; }

  model_real="$(readlink -f "${model_link}")"
  mmproj_real="$(readlink -f "${mmproj_link}")"
  model_dir="$(dirname "${model_real}")"
  mmproj_dir="$(dirname "${mmproj_real}")"

  if [[ "${model_dir}" != "${mmproj_dir}" ]]; then
    log "current 指向不一致：model=${model_dir}, mmproj=${mmproj_dir}"
    exit 1
  fi

  log "current 一致性 OK: ${model_dir}"
}

log "=== 功能測試: 三個 profile ==="
run_switch "gemma-4-e2b-it"
assert_current_pair_consistent
run_switch "gemma-4-e2b-it-q4-k-m"
assert_current_pair_consistent
run_switch "gemma-4-e4b-it"
assert_current_pair_consistent
assert_health

log "=== 穩定性測試: E2B <-> E4B 連續 5 次 ==="
for i in 1 2 3 4 5; do
  log "round ${i}/5: -> e2b"
  run_switch "gemma-4-e2b-it"
  assert_current_pair_consistent
  log "round ${i}/5: -> e4b"
  run_switch "gemma-4-e4b-it"
  assert_current_pair_consistent
done
assert_health

log "全部測試完成"
