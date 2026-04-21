"""
routers/chat.py — RAG 問答 API
職責：接收使用者問題，語意搜尋知識庫後由 Gemma 4 E2B 生成回答

端點：
  POST /api/chat/query  → 語意搜尋 + LLM 生成回答
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from models.schemas import RagQueryRequest, RagQueryResponse
from services.rag_service import rag_query

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/query", response_model=RagQueryResponse)
async def query_chat(payload: RagQueryRequest):
    """
    RAG 問答：
      1. 語意搜尋 ChromaDB 最相關的 top_k 段落
      2. 將段落作為 Context 送入 Gemma 4 E2B 生成回答
      3. 回傳答案、來源段落列表及推論延遲
    """
    if not payload.question.strip():
        raise HTTPException(status_code=422, detail="question 不能為空")

    answer, sources, latency = await rag_query(
        question= payload.question,
        top_k=    payload.top_k,
    )
    return RagQueryResponse(
        answer=     answer,
        sources=    sources,
        latency_ms= latency,
    )
