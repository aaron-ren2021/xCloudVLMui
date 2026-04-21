#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# switch-model.sh
# 依模型 ID 切換 llama.cpp 載入模型（model + mmproj 視為同一單位）
#
# 用法：
#   bash scripts/switch-model.sh --model gemma-4-e2b-it
#   bash scripts/switch-model.sh --model gemma-4-e2b-it-q4-k-m
#   bash scripts/switch-model.sh --model gemma-4-e4b-it
###############################################################################

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${PROJECT_DIR}/models"
MODEL_ID=""
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
      cat <<'USAGE'
switch-model.sh
依模型 ID 切換 llama.cpp 載入模型（model + mmproj 同步）

用法：
  bash scripts/switch-model.sh --model gemma-4-e2b-it
  bash scripts/switch-model.sh --model gemma-4-e2b-it-q4-k-m
  bash scripts/switch-model.sh --model gemma-4-e4b-it
USAGE
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

mkdir -p "${LOG_DIR}"

log() {
  local msg="$*"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "[%s] [operator=%s] [target=%s] %s\n" "${ts}" "${OPERATOR}" "${MODEL_ID}" "${msg}" | tee -a "${LOG_FILE}"
}

model_key=""
model_repo=""
model_file=""
mmproj_repo=""
mmproj_file=""
model_alias=""
variant=""
quant=""

case "${MODEL_ID}" in
  gemma-4-e2b-it)
    model_key="gemma-4-e2b-it"
    model_repo="unsloth/gemma-4-E2B-it-GGUF"
    model_file="gemma-4-E2B-it-Q4_K_S.gguf"
    mmproj_repo="unsloth/gemma-4-E2B-it-GGUF"
    mmproj_file="mmproj-BF16.gguf"
    model_alias="gemma-4-e2b-it"
    variant="E2B"
    quant="Q4_K_S"
    ;;
  gemma-4-e2b-it-q4-k-m)
    model_key="gemma-4-e2b-it-q4-k-m"
    model_repo="unsloth/gemma-4-E2B-it-GGUF"
    model_file="gemma-4-E2B-it-Q4_K_M.gguf"
    mmproj_repo="unsloth/gemma-4-E2B-it-GGUF"
    mmproj_file="mmproj-BF16.gguf"
    model_alias="gemma-4-e2b-it"
    variant="E2B"
    quant="Q4_K_M"
    ;;
  gemma-4-e4b-it)
    model_key="gemma-4-e4b-it"
    model_repo="unsloth/gemma-4-E4B-it-GGUF"
    model_file="gemma-4-E4B-it-Q4_K_M.gguf"
    mmproj_repo="unsloth/gemma-4-E4B-it-GGUF"
    mmproj_file="mmproj-BF16.gguf"
    model_alias="gemma-4-e4b-it"
    variant="E4B"
    quant="Q4_K_M"
    ;;
  *)
    echo "不支援的模型 ID: ${MODEL_ID}" >&2
    echo "可用: gemma-4-e2b-it | gemma-4-e2b-it-q4-k-m | gemma-4-e4b-it" >&2
    exit 1
    ;;
esac

if [[ -n "${MODEL_ALIAS_OVERRIDE:-}" ]]; then
  model_alias="${MODEL_ALIAS_OVERRIDE}"
  log "測試覆寫 MODEL_ALIAS -> ${MODEL_ALIAS_OVERRIDE}"
fi

model_dir="${MODELS_DIR}/${model_key}"
current_dir="${MODELS_DIR}/current"

manifest_path="${model_dir}/manifest.json"
model_path="${model_dir}/model.gguf"
mmproj_path="${model_dir}/mmproj.gguf"

download_if_missing() {
  local repo="$1"
  local source_name="$2"
  local output_path="$3"

  if [[ -f "${output_path}" ]]; then
    log "已存在，略過下載: ${output_path}"
    return 0
  fi

  mkdir -p "$(dirname "${output_path}")"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN

  log "下載缺少檔案: repo=${repo}, file=${source_name}"
  if command -v huggingface-cli >/dev/null 2>&1; then
    token_arg=()
    if [[ -n "${HF_TOKEN:-}" ]]; then
      token_arg=(--token "${HF_TOKEN}")
    fi
    huggingface-cli download "${repo}" "${source_name}" \
      --local-dir "${tmp_dir}" \
      --local-dir-use-symlinks False \
      "${token_arg[@]}"
  elif command -v wget >/dev/null 2>&1; then
    local url="https://huggingface.co/${repo}/resolve/main/${source_name}"
    header_arg=()
    if [[ -n "${HF_TOKEN:-}" ]]; then
      header_arg=(--header "Authorization: Bearer ${HF_TOKEN}")
    fi
    wget -c "${header_arg[@]}" -O "${tmp_dir}/${source_name}" "${url}"
  elif command -v curl >/dev/null 2>&1; then
    local url="https://huggingface.co/${repo}/resolve/main/${source_name}"
    header_arg=()
    if [[ -n "${HF_TOKEN:-}" ]]; then
      header_arg=(-H "Authorization: Bearer ${HF_TOKEN}")
    fi
    curl -L --continue-at - "${header_arg[@]}" -o "${tmp_dir}/${source_name}" "${url}"
  else
    log "FATAL: 找不到 huggingface-cli / wget / curl"
    return 1
  fi

  if [[ ! -f "${tmp_dir}/${source_name}" ]]; then
    log "FATAL: 下載完成後找不到檔案 ${source_name}"
    return 1
  fi

  mv -f "${tmp_dir}/${source_name}" "${output_path}"
  log "下載完成: ${output_path}"
}

write_manifest() {
  mkdir -p "${model_dir}"
  cat > "${manifest_path}" <<JSON
{
  "model_id": "${MODEL_ID}",
  "model_repo": "${model_repo}",
  "model_file": "${model_file}",
  "mmproj_repo": "${mmproj_repo}",
  "mmproj_file": "${mmproj_file}",
  "variant": "${variant}",
  "quant": "${quant}",
  "alias": "${model_alias}"
}
JSON
}

atomic_switch_current() {
  mkdir -p "${current_dir}"

  local tmp_model="${current_dir}/.model.gguf.tmp.$$"
  local tmp_mmproj="${current_dir}/.mmproj.gguf.tmp.$$"

  ln -sfn "../${model_key}/model.gguf" "${tmp_model}"
  ln -sfn "../${model_key}/mmproj.gguf" "${tmp_mmproj}"

  mv -Tf "${tmp_model}" "${current_dir}/model.gguf"
  mv -Tf "${tmp_mmproj}" "${current_dir}/mmproj.gguf"
}

validate_target() {
  [[ -f "${model_path}" ]] || { log "驗證失敗：缺 model 檔 ${model_path}"; return 1; }
  [[ -f "${mmproj_path}" ]] || { log "驗證失敗：缺 mmproj 檔 ${mmproj_path}"; return 1; }
}

validate_current_symlinks() {
  local link_model link_mmproj

  [[ -L "${current_dir}/model.gguf" ]] || { log "驗證失敗：current/model.gguf 不是 symlink"; return 1; }
  [[ -L "${current_dir}/mmproj.gguf" ]] || { log "驗證失敗：current/mmproj.gguf 不是 symlink"; return 1; }

  link_model="$(readlink "${current_dir}/model.gguf")"
  link_mmproj="$(readlink "${current_dir}/mmproj.gguf")"

  [[ "${link_model}" == "../${model_key}/model.gguf" ]] || {
    log "驗證失敗：current/model.gguf 未指向目標 model-key"
    log "  expected=../${model_key}/model.gguf"
    log "  actual=${link_model}"
    return 1
  }

  [[ "${link_mmproj}" == "../${model_key}/mmproj.gguf" ]] || {
    log "驗證失敗：current/mmproj.gguf 未指向目標 model-key"
    log "  expected=../${model_key}/mmproj.gguf"
    log "  actual=${link_mmproj}"
    return 1
  }
}

log "模型切換開始 start_ts=${START_TS}"
log "目標配置 key=${model_key} repo=${model_repo} model=${model_file} mmproj=${mmproj_file} alias=${model_alias}"

write_manifest

download_if_missing "${model_repo}" "${model_file}" "${model_path}"
download_if_missing "${mmproj_repo}" "${mmproj_file}" "${mmproj_path}"

log "Step C: 切換前驗證目標模型目錄"
validate_target

log "Step D: 原子切換 current symlink"
atomic_switch_current

log "Step E: 切換後驗證 current 指向一致"
validate_current_symlinks

log "Step F: 重建 llama-cpp"
cd "${PROJECT_DIR}"
MODEL_ALIAS="${model_alias}" docker compose -f docker-compose.yml up -d --force-recreate --no-deps llama-cpp

log "切換完成：${model_alias} (${model_key})"
echo
printf "已切換完成：%s (%s)\n" "${model_alias}" "${model_key}"
echo "log: ${LOG_FILE}"
