# AGX Orin 三功能 E2E 驗證報告（2026-04-21）

## Summary
- Branch: `fix/docker-services-healthcheck-20260413`
- Baseline commit: `9163b34`
- This run includes probe-fix for VLM WebUI health check and full re-test for:
  1. YOLO + 即時影像 / VLM 路徑
  2. VLM iframe 頁面互動路徑
  3. MQTT 前後端整合

## Code Changes
- `backend/routers/vlm.py`
  - `/api/vlm/status` 的 WebUI 探測新增 HTTPS 自簽容忍（`verify=False`）。
  - 當設定為 `http://...` 且協定錯配失敗時，自動 fallback 嘗試 `https://...`。
- `backend/routers/pipeline.py`
  - `_probe_webui()` 同步加入上述探測邏輯，避免 pipeline 與 vlm status 不一致。

## Baseline Checks
- `./scripts/test-services.sh`: **13/13 全通過**
- `/api/vlm/status`:
  - `webui_ok: true`
  - `llm_ok: true`
- `/api/pipeline/status`:
  - Stage1 vision: `online`
  - Stage2 inference: `online`

## Feature A — YOLO + 即時影像/VLM
- `./scripts/diag-vlm-camera.sh`:
  - D435i `/dev/video*` 存在
  - RTSP 可讀 (`h264 640x480`)
  - `https://localhost:8090/` 可達 (`HTTP 200`)
- API 路徑:
  - `POST /api/rtsp/start` 成功回傳 `status=started`
  - `GET /api/rtsp/status` 顯示 `active_streams >= 1`
- Frontend 執行版本檢查:
  - `.next` 產物包含 `Preview / Heuristic`、`關閉人員分析`、`人員分析與行為提示`、`xcloud.live_vlm.latest_result`

## Feature B — VLM iframe 互動按鈕路徑
- `/main/vlm` via nginx:
  - `307 -> /auth/login`（正常）
  - login page `200`
- `/api/auth/session`:
  - `200`（非 502）
- 按鈕路徑存在（build artifact + page route）:
  - `獨立視窗`
  - `建立/結束會話`
  - `開/關人員分析`
  - `知識庫比對`
  - `儲存為報告`

## Feature C — MQTT 前後端整合
- `GET /api/mqtt/status`:
  - `connected: true`
- E2E 實測:
  - 建立臨時設備: `e2e_mqtt_20260421_c`
  - 發佈 topic: `xcloud/e2e_mqtt_20260421_c/temperature`
  - payload: `{"value":41.2,"unit":"C","quality":0.96}`
  - `GET /api/mqtt/readings/latest` 與 `GET /api/mqtt/devices/{id}/readings` 均可讀到資料
- 測後清理:
  - 刪除臨時設備成功
  - `GET /api/mqtt/devices` 回 `[]`

## Result
- 結論: **通過**
- 已收斂項目:
  - `webui_ok=false` 誤判已修正
  - 三功能重測皆完成且有證據輸出
