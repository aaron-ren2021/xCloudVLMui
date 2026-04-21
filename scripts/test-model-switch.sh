#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# test-model-switch.sh
# 模型切換驗證：
#  1) 三個 profile 功能測試
#  2) 回滾測試（故意 alias 驗證失敗）
#  3) 穩定性測試（E2B <-> E4B 連續切換）
###############################################################################

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

log "=== 功能測試: 三個 profile ==="
run_switch "gemma-4-e2b-it"
run_switch "gemma-4-e2b-it-q4-k-m"
run_switch "gemma-4-e4b-it"
assert_health

log "=== 回滾測試: 故意觸發驗證失敗 ==="
set +e
MODEL_ALIAS_OVERRIDE="invalid-alias-for-rollback-test" \
  bash "${SWITCH_SH}" --model "gemma-4-e2b-it"
rc=$?
set -e
if [[ "${rc}" -ne 2 ]]; then
  log "回滾測試失敗：預期 exit code 2，實際=${rc}"
  exit 1
fi
assert_health

log "=== 穩定性測試: E2B <-> E4B 連續 5 次 ==="
for i in 1 2 3 4 5; do
  log "round ${i}/5: -> e2b"
  run_switch "gemma-4-e2b-it"
  log "round ${i}/5: -> e4b"
  run_switch "gemma-4-e4b-it"
done
assert_health

log "=== 體感測試提醒 ==="
log "請手動在切換時觀察 API 短暫中斷是否約 30–90 秒"
log "全部測試完成"
