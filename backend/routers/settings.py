"""
routers/settings.py — 系統設定管理（OCR 引擎、Embedding 模型、LLM 模型）
"""
from __future__ import annotations
import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import get_db
from models.db_models import SystemSettings
from models.schemas import (
    ModelCatalogOut,
    ModelSwitchIn,
    ModelSwitchOut,
    SettingsOut,
    SettingsUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])
settings = get_settings()

# 預設設定
_DEFAULT_MODEL = "gemma-4-e2b-it"
_FALLBACK_MODELS: list[str] = [
    "gemma-4-e2b-it",
    "gemma-4-e2b-it-Q4_K_S",
    "gemma-4-e2b-it-Q4_K_M",
]
_MODEL_PROFILES: dict[str, dict[str, str]] = {
    "gemma-4-e2b-it": {
        "model_alias": "gemma-4-e2b-it",
        "model_repo": "unsloth/gemma-4-E2B-it-GGUF",
        "model_file": "gemma-4-E2B-it-Q4_K_S.gguf",
    },
    "gemma-4-e2b-it-q4-k-m": {
        "model_alias": "gemma-4-e2b-it",
        "model_repo": "unsloth/gemma-4-E2B-it-GGUF",
        "model_file": "gemma-4-E2B-it-Q4_K_M.gguf",
    },
    "gemma-4-e4b-it": {
        "model_alias": "gemma-4-e4b-it",
        "model_repo": "unsloth/gemma-4-E4B-it-GGUF",
        "model_file": "gemma-4-E4B-it-Q4_K_M.gguf",
    },
}
_DEFAULT_SETTINGS: dict[str, str] = {
    "ocr_engine":       "vlm",
    "embed_model_url":  "",
    "embed_model_name": _DEFAULT_MODEL,
    "llm_model_url":    "",
    "llm_model_name":   _DEFAULT_MODEL,
    "chunk_size":       "800",
    "chunk_overlap":    "100",
    "rag_top_k":        "5",
}

_DESCRIPTIONS: dict[str, str] = {
    "ocr_engine":       "圖片文字辨識引擎（vlm = 使用 Gemma 視覺模型 | disabled = 停用 OCR）",
    "embed_model_url":  "向量嵌入端點 URL（留空使用 config.py 預設值）",
    "embed_model_name": "向量嵌入模型名稱",
    "llm_model_url":    "語言模型端點 URL（留空使用 config.py 預設值）",
    "llm_model_name":   "語言模型名稱",
    "chunk_size":       "文件切片大小（字元數）",
    "chunk_overlap":    "相鄰切片重疊字元數",
    "rag_top_k":        "語意搜尋回傳最大段落數",
}


async def _get_all_settings(db: AsyncSession) -> dict[str, str]:
    """從資料庫讀取所有設定，不存在的 key 使用預設值"""
    result = await db.execute(select(SystemSettings))
    rows   = {r.key: r.value for r in result.scalars().all()}
    merged = dict(_DEFAULT_SETTINGS)
    merged.update({k: v for k, v in rows.items() if v is not None})
    return merged


def _unique_nonempty(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        v = (item or "").strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


async def _fetch_remote_models(base_url: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(f"{base_url.rstrip('/')}/v1/models")
            r.raise_for_status()
            data = r.json().get("data", [])
            return _unique_nonempty([m.get("id", "") for m in data if isinstance(m, dict)])
    except Exception as exc:
        logger.warning("Failed to fetch /v1/models from %s: %s", base_url, exc)
        return []


@router.get("", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """取得目前系統設定"""
    s = await _get_all_settings(db)
    return SettingsOut(
        ocr_engine=        s.get("ocr_engine",       "vlm"),
        embed_model_url=   s.get("embed_model_url",  ""),
        embed_model_name=  s.get("embed_model_name", "gemma-4-e2b-it"),
        llm_model_url=     s.get("llm_model_url",    ""),
        llm_model_name=    s.get("llm_model_name",   "gemma-4-e2b-it"),
        chunk_size=        int(s.get("chunk_size",    "800")),
        chunk_overlap=     int(s.get("chunk_overlap", "100")),
        rag_top_k=         int(s.get("rag_top_k",     "5")),
    )


@router.get("/models", response_model=ModelCatalogOut)
async def list_available_models(db: AsyncSession = Depends(get_db)):
    """
    回傳可選模型清單：
    1) 先嘗試讀取 llama.cpp /v1/models（即時）
    2) 合併目前設定與預設候選
    """
    s = await _get_all_settings(db)
    source_url = s.get("llm_model_url", "").strip() or settings.llm_base_url
    remote = await _fetch_remote_models(source_url)

    models = _unique_nonempty([
        _DEFAULT_MODEL,
        s.get("llm_model_name", ""),
        s.get("embed_model_name", ""),
        *remote,
        *_FALLBACK_MODELS,
    ])

    return ModelCatalogOut(
        default_model=_DEFAULT_MODEL,
        source_url=source_url,
        remote_ok=bool(remote),
        models=models,
    )


@router.post("/models/switch", response_model=ModelSwitchOut)
async def switch_model(
    payload: ModelSwitchIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    切換模型設定（寫入 DB），並回傳對應 Docker 切換命令。
    備註：此 API 不直接執行 docker compose，以避免容器權限風險。
    """
    key = payload.model_id.strip()
    profile = _MODEL_PROFILES.get(key)
    if not profile:
        raise HTTPException(status_code=422, detail=f"Unsupported model_id: {payload.model_id}")
    operator = request.headers.get("x-operator") or request.headers.get("x-user") or "unknown"
    client_ip = request.client.host if request.client else "unknown"
    logger.info("Model switch intent: model_id=%s operator=%s client_ip=%s", key, operator, client_ip)

    # 同步更新目前系統設定，讓後端請求 model id 與目標一致
    updates = {
        "llm_model_name": profile["model_alias"],
        "embed_model_name": profile["model_alias"],
    }
    for k, v in updates.items():
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == k))
        row = result.scalar_one_or_none()
        if row:
            row.value = v
        else:
            db.add(SystemSettings(
                id=str(uuid.uuid4()),
                key=k,
                value=v,
                description=_DESCRIPTIONS.get(k),
            ))
    await db.commit()
    logger.info(
        "Model switch setting synced: model_id=%s alias=%s repo=%s file=%s operator=%s",
        key, profile["model_alias"], profile["model_repo"], profile["model_file"], operator,
    )

    cmd = (
        f"make switch-model MODEL={key}"
    )
    return ModelSwitchOut(
        ok=True,
        model_id=key,
        model_alias=profile["model_alias"],
        model_repo=profile["model_repo"],
        model_file=profile["model_file"],
        switch_command=cmd,
        requires_restart=True,
    )


@router.put("", response_model=SettingsOut)
async def update_settings(
    payload: SettingsUpdate,
    db:      AsyncSession = Depends(get_db),
):
    """更新系統設定（只更新傳入的欄位）"""
    updates: dict[str, str] = {}
    if payload.ocr_engine       is not None: updates["ocr_engine"]       = payload.ocr_engine
    if payload.embed_model_url  is not None: updates["embed_model_url"]  = payload.embed_model_url
    if payload.embed_model_name is not None: updates["embed_model_name"] = payload.embed_model_name
    if payload.llm_model_url    is not None: updates["llm_model_url"]    = payload.llm_model_url
    if payload.llm_model_name   is not None: updates["llm_model_name"]   = payload.llm_model_name
    if payload.chunk_size       is not None: updates["chunk_size"]       = str(payload.chunk_size)
    if payload.chunk_overlap    is not None: updates["chunk_overlap"]    = str(payload.chunk_overlap)
    if payload.rag_top_k        is not None: updates["rag_top_k"]        = str(payload.rag_top_k)

    for key, value in updates.items():
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
        row    = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(SystemSettings(
                id=          str(uuid.uuid4()),
                key=         key,
                value=       value,
                description= _DESCRIPTIONS.get(key),
            ))

    await db.commit()
    logger.info("Settings updated: %s", list(updates.keys()))
    return await get_settings(db)


@router.post("/reset", response_model=SettingsOut)
async def reset_settings(db: AsyncSession = Depends(get_db)):
    """重置所有設定為預設值"""
    result = await db.execute(select(SystemSettings))
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()
    logger.info("Settings reset to defaults.")
    return await get_settings(db)
