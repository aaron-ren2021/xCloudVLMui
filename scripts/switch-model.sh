#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# switch-model.sh
# 依模型 ID 切換 llama.cpp 載入模型（會重新建立 model-init / llama-cpp / backend）
#
# 用法：
#   bash scripts/switch-model.sh --model gemma-4-e2b-it
#   bash scripts/switch-model.sh --model gemma-4-e2b-it-q4-k-m
#   bash scripts/switch-model.sh --model gemma-4-e4b-it
###############################################################################

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_ID=""
DEFAULT_MODEL_ID="gemma-4-e2b-it"
LOG_DIR="${PROJECT_DIR}/logs"
LOG_FILE="${LOG_DIR}/model-switch.log"
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OPERATOR="${USER:-unknown}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL_ID="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
switch-model.sh
依模型 ID 切換 llama.cpp 載入模型（會重新建立 model-init / llama-cpp / backend）

用法：
  bash scripts/switch-model.sh --model gemma-4-e2b-it
  bash scripts/switch-model.sh --model gemma-4-e2b-it-q4-k-m
  bash scripts/switch-model.sh --model gemma-4-e4b-it
EOF
      exit 0
      ;;
    *)
      echo "未知參數: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${MODEL_ID}" ]]; then
  echo "請指定 --model <model-id>" >&2
  exit 1
fi

MODEL_REPO=""
MODEL_FILE=""
MODEL_ALIAS=""

case "${MODEL_ID}" in
  gemma-4-e2b-it)
    MODEL_REPO="unsloth/gemma-4-E2B-it-GGUF"
    MODEL_FILE="gemma-4-E2B-it-Q4_K_S.gguf"
    MODEL_ALIAS="gemma-4-e2b-it"
    ;;
  gemma-4-e2b-it-q4-k-m)
    MODEL_REPO="unsloth/gemma-4-E2B-it-GGUF"
    MODEL_FILE="gemma-4-E2B-it-Q4_K_M.gguf"
    MODEL_ALIAS="gemma-4-e2b-it"
    ;;
  gemma-4-e4b-it)
    MODEL_REPO="unsloth/gemma-4-E4B-it-GGUF"
    MODEL_FILE="gemma-4-E4B-it-Q4_K_M.gguf"
    MODEL_ALIAS="gemma-4-e4b-it"
    ;;
  *)
    echo "不支援的模型 ID: ${MODEL_ID}" >&2
    echo "可用: gemma-4-e2b-it | gemma-4-e2b-it-q4-k-m | gemma-4-e4b-it" >&2
    exit 1
    ;;
esac

if [[ -n "${MODEL_ALIAS_OVERRIDE:-}" ]]; then
  log_msg="測試覆寫 MODEL_ALIAS -> ${MODEL_ALIAS_OVERRIDE}"
  MODEL_ALIAS="${MODEL_ALIAS_OVERRIDE}"
else
  log_msg=""
fi

mkdir -p "${LOG_DIR}"

log() {
  local msg="$*"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "[%s] [operator=%s] [target=%s] %s\n" "${ts}" "${OPERATOR}" "${MODEL_ID}" "${msg}" | tee -a "${LOG_FILE}"
}

wait_http_ok() {
  local url="$1"
  local max_try="${2:-30}"
  local sleep_s="${3:-2}"
  local i=1
  while [[ "${i}" -le "${max_try}" ]]; do
    if curl -sf --max-time 3 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep "${sleep_s}"
  done
  return 1
}

current_model_id() {
  curl -s --max-time 4 "http://localhost:8080/v1/models" 2>/dev/null | \
    sed -n 's/.*"id":"\([^"]\+\)".*/\1/p' | head -n 1
}

apply_compose() {
  local repo="$1"
  local file="$2"
  local alias="$3"
  MODEL_REPO="${repo}" MODEL_FILE="${file}" MODEL_ALIAS="${alias}" \
    docker compose -f docker-compose.yml up -d --force-recreate model-init llama-cpp backend vlm-webui nginx
}

validate_stack() {
  local expected_alias="$1"
  wait_http_ok "http://localhost:8080/health" 45 2 || return 1
  wait_http_ok "http://localhost:8000/api/health" 45 2 || return 1
  local loaded
  loaded="$(current_model_id || true)"
  [[ -n "${loaded}" && "${loaded}" == *"${expected_alias}"* ]]
}

rollback_to_default() {
  local d_repo d_file d_alias
  case "${DEFAULT_MODEL_ID}" in
    gemma-4-e2b-it)
      d_repo="unsloth/gemma-4-E2B-it-GGUF"
      d_file="gemma-4-E2B-it-Q4_K_S.gguf"
      d_alias="gemma-4-e2b-it"
      ;;
    *)
      log "FATAL: 未知 default model: ${DEFAULT_MODEL_ID}"
      return 1
      ;;
  esac
  log "開始自動回滾至 ${DEFAULT_MODEL_ID}"
  MODEL_REPO="${d_repo}" MODEL_FILE="${d_file}" \
    bash "${PROJECT_DIR}/scripts/download-model.sh" --yes
  cd "${PROJECT_DIR}"
  apply_compose "${d_repo}" "${d_file}" "${d_alias}"
  if validate_stack "${d_alias}"; then
    log "回滾成功：${d_alias} (${d_file})"
    return 0
  fi
  log "回滾失敗：請人工介入排查"
  return 1
}

log "模型切換開始 start_ts=${START_TS}"
log "目標配置 MODEL_REPO=${MODEL_REPO} MODEL_FILE=${MODEL_FILE} MODEL_ALIAS=${MODEL_ALIAS}"
if [[ -n "${log_msg}" ]]; then
  log "${log_msg}"
fi

# Step A: 切換前健康檢查
if wait_http_ok "http://localhost:8080/health" 8 1; then
  before_model="$(current_model_id || true)"
  log "前置健康檢查 OK /health=up /v1/models=${before_model:-unknown}"
else
  log "前置健康檢查 WARN：llama.cpp 目前未健康，仍繼續執行切換"
fi

# 先確保模型存在
log "Step B: 確認模型檔案存在，不存在則下載"
MODEL_REPO="${MODEL_REPO}" MODEL_FILE="${MODEL_FILE}" \
  bash "${PROJECT_DIR}/scripts/download-model.sh" --yes

# 重新套用服務（llama-cpp + backend）
log "Step C: 重建 model-init/llama-cpp/backend/vlm-webui/nginx"
cd "${PROJECT_DIR}"
apply_compose "${MODEL_REPO}" "${MODEL_FILE}" "${MODEL_ALIAS}"

# Step D: 切換後驗證
log "Step D: 驗證新模型載入與 API 健康"
if validate_stack "${MODEL_ALIAS}"; then
  after_model="$(current_model_id || true)"
  log "切換成功 /v1/models=${after_model:-unknown}"
  echo
  echo "已切換完成：${MODEL_ALIAS} (${MODEL_FILE})"
  echo "log: ${LOG_FILE}"
  exit 0
fi

# Step E: 自動回滾
log "Step E: 切換驗證失敗，啟動自動回滾"
if rollback_to_default; then
  echo
  echo "切換失敗，已自動回滾至 ${DEFAULT_MODEL_ID}。"
  echo "log: ${LOG_FILE}"
  exit 2
fi

echo
echo "切換失敗且回滾失敗，請查看 ${LOG_FILE}。"
exit 3
