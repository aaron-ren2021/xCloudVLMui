"""
schemas.py — Pydantic v2 請求/回應 Schema
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field
import uuid


# ── 通用 ──────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:       str            # "ok" | "degraded"
    version:      str = "1.1.0"
    llm_ok:       bool = False
    chroma_ok:    bool = False
    db_ok:        bool = False
    mqtt_ok:      bool = False
    timestamp:    datetime


# ── Equipment ─────────────────────────────────────────────────────────

class EquipmentOut(BaseModel):
    id:               str
    name:             str
    type:             str
    location:         str
    status:           str          # normal | warning | critical | offline
    vhs_score:        float = 0.0
    active_alerts:    int   = 0
    last_inspection:  Optional[str] = None


class EquipmentSummary(BaseModel):
    total:    int
    normal:   int
    warning:  int
    critical: int
    offline:  int


class VhsDataPoint(BaseModel):
    timestamp:    str           # 顯示用標籤 "MM/DD"
    score:        float         # 0–100（當日平均或唯一值）
    equipment_id: str
    source:       str = "estimated"   # vlm | manual | seed | estimated（DB 無資料時補算）
    reading_count: int = 0            # 當日有幾筆真實記錄（0 = 估算）


class VhsReadingCreate(BaseModel):
    equipment_id: str
    score:        float = Field(..., ge=0.0, le=100.0)
    source:       str   = "manual"   # vlm | manual
    notes:        Optional[str] = None
    recorded_at:  Optional[datetime] = None   # 未填則用 server time


class VhsReadingOut(BaseModel):
    id:           str
    equipment_id: str
    score:        float
    source:       str
    notes:        Optional[str] = None
    recorded_at:  datetime
    created_at:   datetime

    model_config = {"from_attributes": True}


class VhsTrendMeta(BaseModel):
    equipment_id:   str
    days:           int
    real_days:      int    # 有真實 DB 記錄的天數
    estimated_days: int    # 補算天數
    data:           list[VhsDataPoint]


# ── Pipeline Status ───────────────────────────────────────────────────

class PipelineStageOut(BaseModel):
    stage:        int           # 1–4
    key:          str           # vision | inference | rag | output
    label:        str
    subtitle:     str
    status:       str           # online | offline | warning | unknown
    status_label: str           # 線上 | 離線 | 警告 | 未知
    metrics:      dict[str, str]  # 顯示用 KV（全為 str，前端直接渲染）
    checked_at:   datetime

class PipelineStatusOut(BaseModel):
    stages:       list[PipelineStageOut]
    overall:      str           # online | degraded | offline
    checked_at:   datetime


class AlertOut(BaseModel):
    id:             str
    equipment_id:   str
    equipment_name: str
    level:          str   # critical | elevated | moderate | low
    message:        str
    created_at:     datetime
    resolved:       bool = False
    resolved_at:    Optional[datetime] = None

    model_config = {"from_attributes": True}


class AlertCreate(BaseModel):
    equipment_id:   str
    equipment_name: str
    level:          str = "moderate"
    message:        str


# ── Reports ───────────────────────────────────────────────────────────

class ReportCreate(BaseModel):
    title:            str
    equipment_id:     Optional[str] = None
    equipment_name:   Optional[str] = None
    risk_level:       str           = "moderate"
    source:           str           = "manual"
    raw_vlm_json:     Optional[dict[str, Any]] = None
    markdown_content: Optional[str] = None


class ReportOut(BaseModel):
    id:               str
    title:            str
    equipment_id:     Optional[str] = None
    equipment_name:   Optional[str] = None
    risk_level:       str
    source:           str
    markdown_content: Optional[str] = None
    created_at:       datetime
    updated_at:       datetime

    class Config:
        from_attributes = True


class VlmSessionCapture(BaseModel):
    """VLM WebUI 巡檢結束後，前端呼叫此 API 觸發報告產生"""
    session_id:   str
    source:       str = "vlm-webui"
    captured_at:  str
    raw_vlm_json: Optional[dict[str, Any]] = None
    equipment_id: Optional[str] = None
    equipment_name: Optional[str] = None
    operator_note: Optional[str] = None


# ── RAG ───────────────────────────────────────────────────────────────

class RagSource(BaseModel):
    filename: str
    page:     Optional[int]   = None
    score:    Optional[float] = None


class RagQueryRequest(BaseModel):
    question:   str
    session_id: Optional[str] = None
    top_k:      int = 5


class RagQueryResponse(BaseModel):
    answer:     str
    sources:    list[RagSource] = []
    latency_ms: int = 0


class RagDocumentOut(BaseModel):
    id:          str
    filename:    str
    file_type:   str
    file_size:   Optional[int] = None
    description: Optional[str] = None
    chunk_count: int
    embedded:    bool
    created_at:  datetime

    class Config:
        from_attributes = True


# ── Auth ──────────────────────────────────────────────────────────────

class UserUpsert(BaseModel):
    """NextAuth callback 呼叫，同步使用者資料"""
    id:          str
    name:        Optional[str] = None
    email:       Optional[str] = None
    image:       Optional[str] = None
    provider:    Optional[str] = None
    provider_id: Optional[str] = None


class UserOut(BaseModel):
    id:          str
    name:        Optional[str] = None
    email:       Optional[str] = None
    image:       Optional[str] = None
    provider:    Optional[str] = None
    created_at:  datetime

    class Config:
        from_attributes = True


# ── Settings ──────────────────────────────────────────────────────────

class SettingItem(BaseModel):
    key:         str
    value:       Optional[str] = None
    description: Optional[str] = None


class SettingsOut(BaseModel):
    ocr_engine:        str   = "vlm"          # vlm | disabled
    embed_model_url:   str   = ""
    embed_model_name:  str   = "gemma-4-e2b-it"
    llm_model_url:     str   = ""
    llm_model_name:    str   = "gemma-4-e2b-it"
    chunk_size:        int   = 800
    chunk_overlap:     int   = 100
    rag_top_k:         int   = 5


class SettingsUpdate(BaseModel):
    ocr_engine:        Optional[str] = None
    embed_model_url:   Optional[str] = None
    embed_model_name:  Optional[str] = None
    llm_model_url:     Optional[str] = None
    llm_model_name:    Optional[str] = None
    chunk_size:        Optional[int] = None
    chunk_overlap:     Optional[int] = None
    rag_top_k:         Optional[int] = None


class ModelCatalogOut(BaseModel):
    default_model: str
    source_url:    str
    remote_ok:     bool
    models:        list[str]


class ModelSwitchIn(BaseModel):
    model_id: str


class ModelSwitchOut(BaseModel):
    ok:               bool
    model_id:         str
    model_alias:      str
    model_repo:       str
    model_file:       str
    switch_command:   str
    requires_restart: bool = True


# ── Feature Flags ─────────────────────────────────────────────────────

class FeatureFlagOut(BaseModel):
    key:         str
    enabled:     bool
    rollout_pct: int                          = 100
    description: Optional[str]               = None
    # ORM 屬性名為 extra_config（metadata 是 SQLAlchemy 保留名），
    # 透過 validation_alias 從 ORM 讀取，序列化仍輸出為 metadata
    metadata:    Optional[dict[str, Any]]    = Field(None, validation_alias="extra_config")
    updated_at:  datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class FeatureFlagUpdate(BaseModel):
    enabled:     Optional[bool]              = None
    rollout_pct: Optional[int]               = Field(None, ge=0, le=100)
    description: Optional[str]              = None
    metadata:    Optional[dict[str, Any]]   = None


class FeatureFlagBulkResponse(BaseModel):
    """GET /api/settings/feature-flags 回應：所有旗標的 key→enabled 快照"""
    flags:       list[FeatureFlagOut]
    # 便利欄位：key → bool，供前端快速查詢
    enabled_map: dict[str, bool]


class ImageUploadOut(BaseModel):
    id:          str
    filename:    str
    file_type:   str
    file_size:   Optional[int] = None
    ocr_text:    Optional[str] = None
    chunk_count: int
    embedded:    bool
    created_at:  datetime

    class Config:
        from_attributes = True


# ── MQTT ──────────────────────────────────────────────────────────────

class MqttDeviceCreate(BaseModel):
    device_id:    str
    name:         str
    device_type:  str = "sensor"
    location:     Optional[str] = None
    topic_prefix: str
    description:  Optional[str] = None


class MqttDeviceUpdate(BaseModel):
    name:         Optional[str] = None
    device_type:  Optional[str] = None
    location:     Optional[str] = None
    topic_prefix: Optional[str] = None
    description:  Optional[str] = None


class MqttDeviceOut(BaseModel):
    id:           str
    device_id:    str
    name:         str
    device_type:  str
    location:     Optional[str] = None
    topic_prefix: str
    description:  Optional[str] = None
    online:       bool
    last_seen:    Optional[datetime] = None
    created_at:   datetime

    class Config:
        from_attributes = True


class MqttSensorReadingOut(BaseModel):
    id:          str
    device_id:   str
    topic:       str
    sensor_type: str
    value:       Optional[float] = None
    unit:        Optional[str] = None
    quality:     str
    timestamp:   datetime

    class Config:
        from_attributes = True


class MqttLatestReading(BaseModel):
    device_id:   str
    device_name: str
    topic:       str
    sensor_type: str
    value:       Optional[float] = None
    unit:        Optional[str] = None
    quality:     str
    timestamp:   str


class MqttBrokerStatus(BaseModel):
    connected:    bool
    broker_host:  str
    broker_port:  int
    client_id:    str
    subscriptions: list[str]
    message_count: int
    uptime_seconds: float


class MqttPublishRequest(BaseModel):
    topic:   str
    payload: str
    qos:     int = 0
    retain:  bool = False


class MqttThresholdCreate(BaseModel):
    sensor_type: str
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None
    warn_min:    Optional[float] = None
    warn_max:    Optional[float] = None
    unit:        Optional[str]   = None
    enabled:     bool = True

class MqttThresholdOut(BaseModel):
    id:          str
    device_id:   str
    sensor_type: str
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None
    warn_min:    Optional[float] = None
    warn_max:    Optional[float] = None
    unit:        Optional[str]   = None
    enabled:     bool
    created_at:  datetime
    updated_at:  datetime
    class Config:
        from_attributes = True

class MqttDeviceDetail(BaseModel):
    id:           str
    device_id:    str
    name:         str
    device_type:  str
    location:     Optional[str] = None
    topic_prefix: str
    description:  Optional[str] = None
    online:       bool
    last_seen:    Optional[datetime] = None
    created_at:   datetime
    reading_count: int = 0
    sensor_types:  list[str] = []
    thresholds:    list[MqttThresholdOut] = []

class MqttChartPoint(BaseModel):
    timestamp: datetime
    value:     Optional[float] = None
    quality:   str = "good"
