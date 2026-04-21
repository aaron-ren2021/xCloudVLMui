#!/usr/bin/env bash
###############################################################################
# test-services.sh — 驗證所有服務是否正常運行
###############################################################################
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PASS=0; FAIL=0

check() {
  local name="$1"; local url="$2"; local expect="${3:-200}"
  local code
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  local expect_regex="$expect"
  if [[ "$expect" == *","* ]]; then
    expect_regex="${expect//,/|}"
  fi
  if [[ "$expect" == *"|"* && "$code" =~ ^(${expect_regex})$ ]]; then
    echo -e "  ${GREEN}✓${NC} ${name} → HTTP ${code}"
    ((PASS+=1))
  elif [[ "$code" == "$expect" || ("$expect" == "200" && "$code" =~ ^2) ]]; then
    echo -e "  ${GREEN}✓${NC} ${name} → HTTP ${code}"
    ((PASS+=1))
  else
    echo -e "  ${RED}✗${NC} ${name} → HTTP ${code} (期待 ${expect})"
    ((FAIL+=1))
  fi
}

json_check() {
  local name="$1"; local url="$2"; local key="$3"
  local result
  result=$(curl -sk --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$key' in d" 2>/dev/null; then
    local val
    val=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$key','?'))" 2>/dev/null)
    echo -e "  ${GREEN}✓${NC} ${name} → ${key}=${val}"
    ((PASS+=1))
  else
    echo -e "  ${RED}✗${NC} ${name} → 回應缺少 '${key}' 欄位"
    ((FAIL+=1))
  fi
}

echo -e "\n${BLUE}══════════════════════════════════════════${NC}"
echo -e "${BLUE}  xCloudVLMUI 服務健康檢查${NC}"
echo -e "${BLUE}══════════════════════════════════════════${NC}\n"

# ── llama.cpp ─────────────────────────────────────────────────────
echo -e "${YELLOW}[1/6] llama.cpp Server (:8080)${NC}"
check   "Health Endpoint"  "http://localhost:8080/health"
json_check "Models List"   "http://localhost:8080/v1/models" "data"

# ── 推論測試 ──────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/6] Gemma 4 E2B 推論測試${NC}"
echo -ne "  ${BLUE}►${NC} 呼叫 /v1/chat/completions（約 10-30 秒）... "
ACTIVE_MODEL=$(curl -sk --max-time 8 "http://localhost:8080/v1/models" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or [{}])[0].get('id','gemma-4-e2b-it'))" 2>/dev/null || echo "gemma-4-e2b-it")
INFER_RESULT=$(curl -sk --max-time 60 \
  -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${ACTIVE_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"回覆OK\"}],\"max_tokens\":5}" \
  2>/dev/null || echo "{}")
if echo "$INFER_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('choices')" 2>/dev/null; then
  echo -e "${GREEN}✓ 推論正常${NC}"
  ((PASS+=1))
else
  echo -e "${RED}✗ 推論失敗${NC}"
  ((FAIL+=1))
fi

# ── FastAPI Backend ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/6] FastAPI Backend (:8000)${NC}"
check      "Root Endpoint"    "http://localhost:8000/"
json_check "Health Check"     "http://localhost:8000/api/health"  "status"
check      "Dashboard API"    "http://localhost:8000/api/dashboard/summary"
check      "Swagger Docs"     "http://localhost:8000/docs"

# ── D435i RTSP Bridge ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/6] RealSense RTSP Bridge (:8554 localhost only)${NC}"
if docker compose ps realsense-rtsp 2>/dev/null | grep -q "realsense-rtsp"; then
  echo -e "  ${GREEN}✓${NC} realsense-rtsp 容器存在"
  ((PASS+=1))
else
  echo -e "  ${RED}✗${NC} 找不到 realsense-rtsp 容器"
  ((FAIL+=1))
fi

if docker exec realsense-rtsp ffprobe -v error -rtsp_transport tcp \
  -select_streams v:0 -show_entries stream=codec_name,width,height \
  -of default=nw=1 rtsp://127.0.0.1:8554/d435i >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} D435i RTSP 串流可讀取"
  ((PASS+=1))
else
  echo -e "  ${RED}✗${NC} D435i RTSP 串流不可讀取（檢查 /dev/video4 與 realsense-rtsp logs）"
  ((FAIL+=1))
fi

# ── live-vlm-webui ────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5/6] live-vlm-webui (:8090)${NC}"
check "WebUI Root"  "https://localhost:8090/" "200|301|302|307"

# ── Next.js Frontend ──────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[6/6] Next.js Frontend (:3000 / nginx :80)${NC}"
check "Frontend :3000"     "http://localhost:3000/" "200|301|302|307"
check "Via Nginx :80"      "http://localhost/" "200|301|302|307"
check "API via Nginx"      "http://localhost/api/health"

# ── 結果摘要 ─────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}══════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}✓ 全部通過 ${PASS}/${TOTAL}${NC}"
else
  echo -e "${YELLOW}結果：${GREEN}${PASS} 通過${NC} / ${RED}${FAIL} 失敗${NC} / 共 ${TOTAL}"
fi
echo -e "${BLUE}══════════════════════════════════════════${NC}\n"

[[ $FAIL -eq 0 ]] || exit 1
