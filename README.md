<!-- xCloudVLMui — README.md -->
<div align="center">

make setup

[![Platform](https://img.shields.io/badge/Platform-Jetson%20AGX%20Orin%2064GB-76b900?logo=nvidia&logoColor=white)](https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/jetson-agx-orin/)
[![JetPack](https://img.shields.io/badge/JetPack-6.0-76b900?logo=nvidia&logoColor=white)](https://developer.nvidia.com/embedded/jetpack)
[![CUDA](https://img.shields.io/badge/CUDA-12.2.1-76b900?logo=nvidia&logoColor=white)]()
[![Python](https://img.shields.io/badge/Python-3.11-3776ab?logo=python&logoColor=white)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white)]()
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)]()
[![Docker](https://img.shields.io/badge/Docker-Compose%20v2-2496ED?logo=docker&logoColor=white)]()
[![License](https://img.shields.io/badge/License-Proprietary-red)]()

> 由 **云碩科技 xCloudinfo Corp.Limited** 開發
> 專為 **Advantech AIR-030 (Jetson AGX Orin 64GB)** 邊緣主機設計的工廠設備健康管理平台

</div>

---

## 目錄

- [產品概述](#產品概述)
- [核心功能](#核心功能)
- [系統架構](#系統架構)
- [技術棧](#技術棧)
- [快速開始](#快速開始)
- [文件索引](#文件索引)
- [專案管理](#專案管理)
- [貢獻指南](#貢獻指南)

---

## 產品概述

**xCloudVLMui** 是一套由 **云碩科技 xCloudinfo Corp.Limited** 開發，執行於 Advantech AIR-030 邊緣主機的**工廠設備健康管理平台**，結合：

| 能力 | 說明 |
|-----|------|
| 🤖 **視覺語言模型推論** | Gemma 4 E2B Q4_K_M，128K context，30–50 tok/s |
| 📡 **MQTT 感應器整合** | Eclipse Mosquitto，溫度 / 震動 / 壓力 / 轉速即時監控 |
| 🧠 **RAG 知識庫** | ChromaDB + Gemma Embeddings，PDF/TXT/MD/CSV 文件語意問答 |
| 📊 **設備健康儀表板** | VHS 分數趨勢、四段式管線狀態、警報 CRUD |
| 🔐 **多方式認證** | Microsoft Entra ID / Google / GitHub OAuth + 本地管理員 |
| 📦 **生產打包工具** | 一鍵 Docker 映像打包，離線 AIR-030 部署 |

---

## 核心功能

```
┌──────────────────┬────────────────────────────────────────────────────┐
│  設備總覽儀表板   │ VHS 趨勢 / Pipeline Status / 詳情抽屜 / 警報       │
│  視覺巡檢        │ WebRTC 串流 / Gemma 4 E2B 即時視覺診斷              │
│  MQTT 監控       │ 感應器即時數值 / 歷史圖表 / 閾值警報                │
│  MQTT 設備管理   │ 設備 CRUD / Topic 管理 / 警報閾值設定               │
│  維修知識庫       │ RAG 語意問答 / 參考來源顯示                         │
│  知識文件管理     │ PDF 上傳 / OCR / 向量嵌入 / ChromaDB               │
│  維護報告        │ VLM → Markdown 自動報告 / 軟刪除 / 下載             │
│  事件中心        │ 全系統 syslog / 等級篩選 / 統計                     │
│  系統設定        │ OCR 引擎 / Embedding 模型 / LLM 模型切換            │
└──────────────────┴────────────────────────────────────────────────────┘
```

---

## 系統架構

```
使用者端（瀏覽器）
      │
      ▼  HTTP / WebSocket / WebRTC
┌─────────────────────────────────────┐
│   Nginx 反向代理   :80              │
│   /    → Frontend :3000             │
│   /api → Backend  :8000             │
│   /vlm → VLM WebUI:8090             │
└──────┬──────────────┬───────────────┘
       │              │
┌──────▼──────┐  ┌────▼──────────────────┐  ┌──────────────────────┐
│  Next.js 14 │  │  FastAPI + SQLite     │  │  VLM WebUI  :8090    │
│  TypeScript │  │  ChromaDB + syslog.db │  │  WebRTC  ARM64       │
└─────────────┘  └────────┬─────────────┘  └──────────────────────┘
                          │ OpenAI API
                 ┌────────▼────────────┐
                 │  llama-cpp  :8080   │
                 │  Gemma 4 E2B GGUF   │
                 │  128K Context       │
                 └─────────────────────┘

┌──────────────────────────────────┐
│  Eclipse Mosquitto  :1883 / 9001 │
│  ← 感應器設備上報                │
│  → Backend 訂閱 xcloud/#        │
└──────────────────────────────────┘
```

### 服務清單

| 服務 | Container | Port | 說明 |
|-----|-----------|------|-----|
| `model-init` | model-init | — | 首次啟動下載 GGUF 模型 |
| `llama-cpp` | llama-cpp | 8080 | Gemma 4 E2B 推論引擎 (OpenAI API) |
| `vlm-webui` | vlm-webui | 8090 | WebRTC 即時視覺分析 |
| `backend` | xcloud-backend | 8000 | FastAPI 中介層 |
| `frontend` | xcloud-frontend | 3000 | Next.js 儀表板 |
| `nginx` | xcloud-nginx | 80 | 反向代理入口 |
| `mosquitto` | mosquitto | 1883/9001 | MQTT Broker |

---

## 技術棧

| 層次 | 技術 | 版本 |
|-----|------|------|
| **前端** | Next.js + TypeScript | 14.2.5 / 5.5.3 |
| **前端樣式** | Tailwind CSS + Shadcn UI | 3.4.6 |
| **前端認證** | NextAuth.js | v5 beta |
| **後端** | FastAPI + Python | 0.110+ / 3.11 |
| **ORM** | SQLAlchemy async + Pydantic v2 | 2.x |
| **主資料庫** | SQLite + aiosqlite | — |
| **向量資料庫** | ChromaDB | — |
| **推論引擎** | llama.cpp (llama-server) | r36.4-tegra |
| **模型** | Gemma 4 E2B Q4_K_M | ~3.8GB / 128K ctx |
| **MQTT** | Eclipse Mosquitto | 2.x |
| **容器化** | Docker + Compose v2 | 24.x / v2.x |
| **反向代理** | Nginx | 1.25 Alpine |
| **OS / SDK** | Ubuntu 22.04 / JetPack 6.0 | CUDA 12.2.1 |

---

## 快速開始

### 前置需求

```bash
# Jetson AGX Orin — JetPack 6.0
docker --version          # 24.0+
docker compose version    # v2.20+
nvidia-ctk --version      # 1.14+
```

### 一鍵部署

```bash
# 1. 複製專案
git clone https://github.com/guessleej/xCloudVLMui.git
cd xCloudVLMui

# 2. 初始化（SSL + .env + 下載模型）
make setup

# 3. 編輯環境變數
nano backend/.env
nano frontend/.env.local

# 4. 啟動服務
make up

# 5. 驗證健康狀態
make test
```

### 存取入口

| 服務 | URL |
|-----|-----|
| Web UI | http://\<HOST\>/ |
| API Docs | http://\<HOST\>/docs |
| VLM WebUI | http://\<HOST\>:8090 |
| llama.cpp | http://\<HOST\>:8080 |

### Makefile 常用指令

```bash
make setup          # 初始化
make up             # 啟動服務
make down           # 停止服務
make logs           # 查看 Log
make status         # GPU + 容器狀態
make test           # 健康檢查
make release        # 生產打包 (ARM64, 跳過 vlm-webui)
make release-full   # 完整生產打包
make release-amd64  # x86_64 打包（測試用）
```

---

## 文件索引

### 📋 專案管理

| 文件 | 說明 |
|------|------|
| [1.1 專案章程](docs/1-project-management/1.1-project-charter.md) | 目標、範疇、里程碑、干係人 |
| [1.2 風險管理矩陣](docs/1-project-management/1.2-risk-matrix.md) | 風險識別、評估、應對策略 |

### 🏗️ 架構設計

| 文件 | 說明 |
|------|------|
| [2.1 高階架構圖](docs/2-architecture/2.1-high-level-architecture.md) | 系統整體架構、資料流、部署拓撲 |
| [2.2 核心模組設計](docs/2-architecture/2.2-core-module-design.md) | 各模組責任、介面、資料模型 |

### ⚙️ 工程規範

| 文件 | 說明 |
|------|------|
| [3.1 開發流程規範](docs/3-engineering/3.1-development-process.md) | Git Flow、PR 規範、Code Review 標準 |
| [3.2 CI/CD 流水線設計](docs/3-engineering/3.2-cicd-pipeline.md) | 自動化建置、測試、打包、部署流程 |
| [3.3 監控與可觀測性](docs/3-engineering/3.3-monitoring-observability.md) | 日誌、指標、告警、追蹤設計 |

### 🔌 整合框架

| 文件 | 說明 |
|------|------|
| [4.1 標準化適配器框架](docs/4-integration/4.1-adapter-framework.md) | 設備接入介面規範、MQTT/REST 適配器設計 |
| [4.2 漸進式整合路線圖](docs/4-integration/4.2-integration-roadmap.md) | Phase 0→3 整合計畫、里程碑 |

### 📈 績效管理

| 文件 | 說明 |
|------|------|
| [5.1 關鍵績效指標 (KPI)](docs/5-metrics/5.1-kpi.md) | 技術、業務、維護 KPI 定義與基準 |
| [5.2 持續改進循環](docs/5-metrics/5.2-continuous-improvement.md) | PDCA 循環、回顧機制、改進追蹤 |

---

## 專案管理

### 版本紀錄

| 版本 | 日期 | 說明 |
|-----|------|------|
| **v1.1.0** | 2026-04-10 | Dashboard 強化、MQTT、事件中心、生產打包 |
| **v1.0.0** | 2026-04-07 | 初始版本：VLM、RAG、報告、OAuth |

### 路線圖

```
2026 Q2  ▶  v1.2 — MQTT 告警自動推播（LINE / Email）
2026 Q3  ▶  v1.3 — 多站點設備聯網、Dashboard 多語系
2026 Q4  ▶  v2.0 — 雲端同步選項、進階 VLM 模型支援
```

---

## 貢獻指南

1. Fork 此 Repo 並建立 feature branch：`git checkout -b feat/your-feature`
2. 遵循 [3.1 開發流程規範](docs/3-engineering/3.1-development-process.md)
3. 提交 PR 前執行 `make test` 確認所有健康檢查通過
4. PR 標題格式：`[type]: 簡短說明`（type: feat / fix / docs / chore / refactor）

---

<div align="center">

**云碩科技 xCloudinfo Corp.Limited**
© 2026 All rights reserved. Proprietary & Confidential.

[API 文件](http://localhost/docs) · [問題回報](https://github.com/guessleej/xCloudVLMui/issues)

</div>
