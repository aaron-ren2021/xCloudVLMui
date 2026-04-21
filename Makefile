###############################################################################
# Makefile — xCloudVLMui Platform 操作中樞
#
# ┌─ 首次部署 ──────────────────────────────────────────────────────────┐
# │  make setup        # 產生 SSL + 複製 .env + 下載模型                │
# │  make up           # 啟動所有 Docker 服務                           │
# │  make test         # 驗證所有服務健康狀態                           │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌─ 日常操作 ──────────────────────────────────────────────────────────┐
# │  make logs         # 查看所有服務即時 log                           │
# │  make logs-llm     # 只看 llama.cpp log                            │
# │  make restart      # 重啟所有服務                                   │
# │  make down         # 停止並移除容器                                 │
# │  make clean        # 完全清除（含 Volume）                          │
# └────────────────────────────────────────────────────────────────────┘
###############################################################################

.PHONY: all setup download-model gen-ssl env-copy build up down restart \
        logs logs-llm logs-backend logs-frontend logs-mqtt status test ps clean \
        shell-backend shell-llm dev update-model restart-mqtt switch-model test-model-switch \
        release release-amd64 release-full

COMPOSE        := docker compose
COMPOSE_FILE   := -f docker-compose.yml
COMPOSE_DEV    := -f docker-compose.yml -f docker-compose.dev.yml
SCRIPTS_DIR    := scripts
MODEL_REPO     ?= unsloth/gemma-4-E2B-it-GGUF
MODEL_FILE     ?= gemma-4-E2B-it-Q4_K_S.gguf
MODEL_ALIAS    ?= gemma-4-e2b-it

# ── 顏色 ─────────────────────────────────────────────────────────────
BLUE   := \033[0;34m
GREEN  := \033[0;32m
YELLOW := \033[1;33m
NC     := \033[0m

# ── 預設目標 ─────────────────────────────────────────────────────────
all: help

help:
	@echo ""
	@printf "$(BLUE)╔══════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(BLUE)║      xCloudVLMui Platform — AIR-030 操作指令        ║$(NC)\n"
	@printf "$(BLUE)╚══════════════════════════════════════════════════════╝$(NC)\n"
	@echo ""
	@printf "$(YELLOW)首次部署：$(NC)\n"
	@printf "  make setup          產生 SSL + .env + 下載 Gemma 4 E2B 模型\n"
	@printf "  make up             啟動所有服務\n"
	@printf "  make test           驗證所有服務健康狀態\n"
	@echo ""
	@printf "$(YELLOW)日常操作：$(NC)\n"
	@printf "  make logs           查看所有服務 log\n"
	@printf "  make logs-llm       只看 llama.cpp log\n"
	@printf "  make logs-mqtt      只看 mosquitto (MQTT) log\n"
	@printf "  make status         顯示容器狀態與資源使用\n"
	@printf "  make ps             顯示容器列表\n"
	@printf "  make restart        重啟所有服務\n"
	@printf "  make switch-model MODEL=gemma-4-e4b-it  切換推論模型\n"
	@printf "  make down           停止容器\n"
	@printf "  make clean          完全清除（含 Volume 資料）\n"
	@echo ""
	@printf "$(YELLOW)開發模式（本機 / 無 GPU）：$(NC)\n"
	@printf "  make dev            啟動開發模式（程式碼熱重載）\n"
	@echo ""
	@printf "$(YELLOW)生產打包：$(NC)\n"
	@printf "  make release        打包 ARM64 映像（跳過 vlm-webui，速度快）\n"
	@printf "  make release-full   打包 ARM64 完整映像（含 vlm-webui）\n"
	@printf "  make release-amd64  打包 amd64 映像（本機 x86 測試用）\n"
	@echo ""

# ─────────────────────────────────────────────────────────────────────
# 首次設定
# ─────────────────────────────────────────────────────────────────────

## 完整初始化：SSL + .env + 下載模型
setup: gen-ssl env-copy download-model
	@printf "$(GREEN)✓ setup 完成！執行 make up 啟動服務。$(NC)\n"

## 產生自簽 TLS 憑證（WebRTC 需要）
gen-ssl:
	@printf "$(BLUE)► 產生 SSL 憑證...$(NC)\n"
	@bash $(SCRIPTS_DIR)/gen-ssl.sh

## 複製 .env 範本（若不存在）
env-copy:
	@printf "$(BLUE)► 設定環境變數...$(NC)\n"
	@if [ ! -f backend/.env ]; then \
		cp backend/.env.example backend/.env ; \
		printf "$(YELLOW)  ⚠ 已複製 backend/.env，請填入正確設定值。$(NC)\n" ; \
	else \
		printf "$(GREEN)  ✓ backend/.env 已存在。$(NC)\n" ; \
	fi
	@if [ ! -f frontend/.env.local ]; then \
		cp frontend/.env.local.example frontend/.env.local ; \
		printf "$(YELLOW)  ⚠ 已複製 frontend/.env.local，請填入 OAuth Client ID/Secret。$(NC)\n" ; \
	else \
		printf "$(GREEN)  ✓ frontend/.env.local 已存在。$(NC)\n" ; \
	fi

## 下載 Gemma 4 E2B GGUF Q4_K_S 模型
download-model:
	@printf "$(BLUE)► 下載 Gemma 4 E2B GGUF Q4_K_S...$(NC)\n"
	@MODEL_REPO=$(MODEL_REPO) MODEL_FILE=$(MODEL_FILE) bash $(SCRIPTS_DIR)/download-model.sh --yes

# ─────────────────────────────────────────────────────────────────────
# Docker 操作
# ─────────────────────────────────────────────────────────────────────

## 建置所有 Docker 映像
build:
	@printf "$(BLUE)► 建置 Docker 映像...$(NC)\n"
	$(COMPOSE) $(COMPOSE_FILE) build --parallel

## 啟動所有服務（含自動模型下載）
up:
	@printf "$(BLUE)► 啟動 xCloudVLMUI 服務...$(NC)\n"
	MODEL_REPO=$(MODEL_REPO) MODEL_FILE=$(MODEL_FILE) MODEL_ALIAS=$(MODEL_ALIAS) $(COMPOSE) $(COMPOSE_FILE) up -d
	@printf "$(GREEN)✓ 服務已啟動，執行 make logs 查看進度。$(NC)\n"
	@printf "$(YELLOW)  ⚠ 首次啟動 llama.cpp 載入 128K context 約需 2-5 分鐘。$(NC)\n"
	@echo ""
	@printf "  Web UI：     http://localhost\n"
	@printf "  VLM WebUI：  http://localhost:8090\n"
	@printf "  API Docs：   http://localhost/docs\n"
	@printf "  llama.cpp：  http://localhost:8080\n"

## 停止服務
down:
	$(COMPOSE) $(COMPOSE_FILE) down

## 重啟服務
restart:
	$(COMPOSE) $(COMPOSE_FILE) restart

## 只重啟後端
restart-backend:
	$(COMPOSE) $(COMPOSE_FILE) restart backend

## 只重啟 llama.cpp
restart-llm:
	MODEL_REPO=$(MODEL_REPO) MODEL_FILE=$(MODEL_FILE) MODEL_ALIAS=$(MODEL_ALIAS) $(COMPOSE) $(COMPOSE_FILE) up -d --force-recreate model-init llama-cpp backend vlm-webui nginx

## 依模型 ID 切換模型並重建相關服務
## 例：make switch-model MODEL=gemma-4-e4b-it
switch-model:
	@if [ -z "$(MODEL)" ]; then \
		echo "請指定 MODEL，例如：make switch-model MODEL=gemma-4-e4b-it" ; \
		exit 1 ; \
	fi
	@bash $(SCRIPTS_DIR)/switch-model.sh --model $(MODEL)

## 模型切換完整測試（功能/回滾/穩定性）
test-model-switch:
	@bash $(SCRIPTS_DIR)/test-model-switch.sh

# ─────────────────────────────────────────────────────────────────────
# 監控
# ─────────────────────────────────────────────────────────────────────

## 查看所有服務 log（即時）
logs:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100

## 只看 llama.cpp log
logs-llm:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100 llama-cpp

## 只看 backend log
logs-backend:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100 backend

## 只看 frontend log
logs-frontend:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100 frontend

## 只看 mosquitto (MQTT) log
logs-mqtt:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100 mosquitto

## 只重啟 mosquitto
restart-mqtt:
	$(COMPOSE) $(COMPOSE_FILE) restart mosquitto

## 顯示容器列表
ps:
	$(COMPOSE) $(COMPOSE_FILE) ps

## 顯示容器狀態 + GPU 使用
status:
	@printf "$(BLUE)── 容器狀態 ──────────────────────────$(NC)\n"
	$(COMPOSE) $(COMPOSE_FILE) ps
	@echo ""
	@printf "$(BLUE)── GPU 使用率 ────────────────────────$(NC)\n"
	@tegrastats --interval 1000 2>/dev/null | head -3 || \
	 nvidia-smi 2>/dev/null | head -20 || \
	 echo "  (tegrastats / nvidia-smi 不可用)"

# ─────────────────────────────────────────────────────────────────────
# 測試
# ─────────────────────────────────────────────────────────────────────

## 驗證所有服務健康狀態
test:
	@printf "$(BLUE)► 執行健康檢查...$(NC)\n"
	@bash $(SCRIPTS_DIR)/test-services.sh

## 快速 ping 所有端點
ping:
	@for url in \
		"http://localhost:8080/health" \
		"http://localhost:8000/api/health" \
		"http://localhost:8090/" \
		"http://localhost:3000/" \
		"http://localhost/"; do \
		CODE=$$(curl -sk -o /dev/null -w "%{http_code}" --max-time 3 $$url 2>/dev/null || echo "ERR") ; \
		printf "  %-40s → %s\n" "$$url" "$$CODE" ; \
	done

# ─────────────────────────────────────────────────────────────────────
# Shell 進入
# ─────────────────────────────────────────────────────────────────────

shell-backend:
	$(COMPOSE) $(COMPOSE_FILE) exec backend /bin/bash

shell-llm:
	$(COMPOSE) $(COMPOSE_FILE) exec llama-cpp /bin/bash

shell-frontend:
	$(COMPOSE) $(COMPOSE_FILE) exec frontend /bin/sh

# ─────────────────────────────────────────────────────────────────────
# 開發模式
# ─────────────────────────────────────────────────────────────────────

## 本機開發模式（程式碼熱重載，無 GPU 需求）
dev:
	@printf "$(YELLOW)► 開發模式（llama.cpp 使用 CPU，不啟動 vlm-webui）$(NC)\n"
	$(COMPOSE) $(COMPOSE_DEV) up -d --build

dev-down:
	$(COMPOSE) $(COMPOSE_DEV) down

# ─────────────────────────────────────────────────────────────────────
# 清理
# ─────────────────────────────────────────────────────────────────────

## 停止容器並移除（保留 Volume）
clean:
	$(COMPOSE) $(COMPOSE_FILE) down --rmi local
	@printf "$(GREEN)✓ 容器已清除（資料 Volume 保留）。$(NC)\n"

# ─────────────────────────────────────────────────────────────────────
# 生產打包
# ─────────────────────────────────────────────────────────────────────

## 打包 Jetson ARM64 生產映像（跳過 vlm-webui，速度快）
release:
	@printf "$(BLUE)► 打包 ARM64 生產映像（跳過 vlm-webui）...$(NC)\n"
	@bash $(SCRIPTS_DIR)/build-release.sh --platform linux/arm64 --skip-vlm

## 打包 Jetson ARM64 完整生產映像（含 vlm-webui）
release-full:
	@printf "$(BLUE)► 打包 ARM64 完整生產映像（含 vlm-webui）...$(NC)\n"
	@bash $(SCRIPTS_DIR)/build-release.sh --platform linux/arm64

## 打包 x86_64 生產映像（本機測試用）
release-amd64:
	@printf "$(BLUE)► 打包 amd64 生產映像（本機測試）...$(NC)\n"
	@bash $(SCRIPTS_DIR)/build-release.sh --platform linux/amd64 --skip-vlm

## 完全清除（含 Volume / 資料庫 / ChromaDB）
clean-all:
	@printf "$(YELLOW)⚠ 這將刪除所有資料，包含資料庫與向量索引。$(NC)\n"
	@printf "$(YELLOW)確認？(y/N) $(NC)" ; read confirm ; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		$(COMPOSE) $(COMPOSE_FILE) down -v --rmi local ; \
		printf "$(GREEN)✓ 完全清除完成。$(NC)\n" ; \
	else \
		printf "已取消。\n" ; \
	fi

## 只清除模型（重新下載）
clean-model:
	docker volume rm xcloudvlmui_model-data 2>/dev/null || true
	@printf "$(GREEN)✓ 模型 Volume 已清除，下次 make up 時會重新下載。$(NC)\n"
