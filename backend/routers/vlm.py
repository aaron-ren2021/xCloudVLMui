"""
routers/vlm.py — VLM WebUI 狀態查詢 + 診斷代理
"""
import logging
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from urllib.parse import urlsplit, urlunsplit

from config import get_settings

logger   = logging.getLogger(__name__)
router   = APIRouter(prefix="/api/vlm", tags=["vlm"])
settings = get_settings()


async def _probe_webui(url: str) -> bool:
    """
    探測 VLM WebUI。
    - https://... 允許自簽憑證（verify=False）
    - 若 http://... 發生協定錯配失敗，會再嘗試 https://...（verify=False）
    """
    base = url.rstrip("/")
    parsed = urlsplit(base)

    candidates: list[tuple[str, bool]] = [(base, parsed.scheme != "https")]
    if parsed.scheme == "http":
        https_url = urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, parsed.fragment))
        if https_url != base:
            candidates.append((https_url, False))

    for target, verify in candidates:
        try:
            async with httpx.AsyncClient(timeout=5.0, verify=verify) as c:
                r = await c.get(f"{target}/")
                if r.status_code < 500:
                    return True
        except Exception:
            continue

    return False


class VlmStatusResponse(BaseModel):
    webui_ok:    bool
    llm_ok:      bool
    webui_url:   str
    llm_url:     str
    model:       Optional[str] = None


class DiagnoseRequest(BaseModel):
    prompt:       str
    image_base64: Optional[str] = None
    max_tokens:   int = 512
    temperature:  float = 0.05


class DiagnoseResponse(BaseModel):
    content:     str
    model:       Optional[str] = None
    finish_reason: Optional[str] = None


@router.get("/status", response_model=VlmStatusResponse)
async def vlm_status():
    """檢查 live-vlm-webui 與 llama.cpp 服務可用性"""
    webui_ok = llm_ok = False
    model    = None

    # 測試 live-vlm-webui（支援 HTTPS 自簽）
    webui_ok = await _probe_webui(settings.vlm_webui_url)

    # 測試 llama.cpp
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{settings.llm_base_url}/v1/models")
            if r.status_code == 200:
                llm_ok = True
                data   = r.json()
                models = data.get("data", [])
                if models:
                    model = models[0].get("id")
    except Exception as e:
        logger.debug("llama.cpp not reachable: %s", str(e))

    return VlmStatusResponse(
        webui_ok=  webui_ok,
        llm_ok=    llm_ok,
        webui_url= settings.vlm_webui_url,
        llm_url=   settings.llm_base_url,
        model=     model,
    )


@router.post("/diagnose", response_model=DiagnoseResponse)
async def vlm_diagnose(payload: DiagnoseRequest):
    """
    直接呼叫 llama.cpp /v1/chat/completions 進行圖文診斷。
    若有 image_base64，附加為 vision message。
    """
    messages: list[dict[str, Any]] = []

    if payload.image_base64:
        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{payload.image_base64}"},
                },
                {"type": "text", "text": payload.prompt},
            ],
        })
    else:
        messages.append({"role": "user", "content": payload.prompt})

    try:
        async with httpx.AsyncClient(timeout=120.0) as c:
            r = await c.post(
                f"{settings.llm_base_url}/v1/chat/completions",
                json={
                    "model":       settings.llm_model,
                    "messages":    messages,
                    "max_tokens":  payload.max_tokens,
                    "temperature": payload.temperature,
                    "stream":      False,
                },
            )
            r.raise_for_status()
            data   = r.json()
            choice = data["choices"][0]
            return DiagnoseResponse(
                content=       choice["message"]["content"],
                model=         data.get("model"),
                finish_reason= choice.get("finish_reason"),
            )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"llama.cpp 回應錯誤 HTTP {e.response.status_code}",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=503,
            detail="無法連線至 llama.cpp（:8080），請確認服務已啟動。",
        )
