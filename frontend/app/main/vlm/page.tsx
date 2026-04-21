"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  Info,
  Radar,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { dashboardApi, reportsApi, vlmApi, ragApi } from "@/lib/api";
import type { Equipment, RagSource } from "@/types";
import {
  PEOPLE_ACTION_LABELS,
  PEOPLE_ANALYSIS_MODE_LABEL,
  PEOPLE_GENDER_LABELS,
} from "@/lib/people-analysis-adapter";
import type { PeopleAnalysisOutput } from "@/types/vlm-porting";
import { VlmPeopleOverlay } from "@/components/vlm/vlm-people-overlay";
import { VlmSimpleOverlay } from "@/components/vlm/vlm-simple-overlay";

const INSPECTION_SCENARIOS = [
  { title: "外觀與管線異常掃描", detail: "漏油、漏水、鬆脫、外殼變形與異常磨耗。" },
  { title: "控制面板與燈號診斷", detail: "辨識 HMI 錯誤代碼與實體警示燈狀態。" },
  { title: "內部電氣元件檢查", detail: "觀察 NFB、保險絲、接線鬆脫與燒毀痕跡。" },
  { title: "RUL / 預防維護評估", detail: "根據視覺老化跡象判讀健康分數與建議保養時機。" },
];

const CHECKLIST = [
  "確認鏡頭權限與 HTTPS / WebRTC 通道可用。",
  "選擇本次巡檢場景與目標設備，避免在同一輪混入多台設備。",
  "若需要維修建議，先完成現象拍攝，再切換到知識作業台查 SOP。",
];

type VlmStatus = {
  webui_ok: boolean;
  llm_ok: boolean;
  webui_url: string;
  llm_url: string;
  model?: string | null;
};

type SessionState = "idle" | "active" | "ended";
type StandaloneState = "opened" | "closed" | "unknown" | "blocked";

/** 可折疊面板 */
function Collapsible({
  title,
  kicker,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  kicker?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-soft rounded-[28px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              {icon}
            </div>
          )}
          <div>
            {kicker && <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{kicker}</p>}
            <p className="mt-0.5 text-sm font-semibold text-white">{title}</p>
          </div>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-slate-500" />
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-500" />}
      </button>
      {open && <div className="border-t border-white/8 px-5 pb-5 pt-4">{children}</div>}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default function VlmPage() {
  const [saving, setSaving] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [sessionEndedAt, setSessionEndedAt] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const [standaloneState, setStandaloneState] = useState<StandaloneState>("unknown");
  const [standaloneOpenedAt, setStandaloneOpenedAt] = useState<string | null>(null);
  const standaloneWindowRef = useRef<Window | null>(null);
  const standaloneMonitorRef = useRef<number | null>(null);

  const [iframeKey, setIframeKey] = useState(0);
  const [status, setStatus] = useState<VlmStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [peopleOverlayEnabled, setPeopleOverlayEnabled] = useState(true);
  const [peopleSnapshot, setPeopleSnapshot] = useState<PeopleAnalysisOutput | null>(null);
  const [compareQuery, setCompareQuery] = useState("");
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<{
    answer: string;
    sources: RagSource[];
  } | null>(null);

  const [rawJsonInput, setRawJsonInput] = useState("");
  const [rawJsonParsed, setRawJsonParsed] = useState<Record<string, unknown> | null>(null);
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const [operatorNote, setOperatorNote] = useState("");

  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");

  const VLM_URL = process.env.NEXT_PUBLIC_VLM_WEBUI_URL ?? "/vlm";
  const configuredStandaloneVlmUrl = process.env.NEXT_PUBLIC_VLM_STANDALONE_URL?.trim() ?? "";
  const withSyncFlag = useCallback(
    (url: string) => (url.includes("?") ? `${url}&xcloud_sync=1` : `${url}?xcloud_sync=1`),
    [],
  );
  const VLM_SYNC_URL = useMemo(() => withSyncFlag(VLM_URL), [VLM_URL, withSyncFlag]);
  const VLM_MINIMAL_URL = useMemo(() => `${withSyncFlag(VLM_URL)}&minimal=1`, [VLM_URL, withSyncFlag]);
  const STANDALONE_VLM_URL = useMemo(
    () => (configuredStandaloneVlmUrl ? withSyncFlag(configuredStandaloneVlmUrl) : "https://<current-host>:8090/?xcloud_sync=1"),
    [configuredStandaloneVlmUrl, withSyncFlag],
  );
  const resolveStandaloneVlmUrl = useCallback(() => {
    if (configuredStandaloneVlmUrl) {
      return withSyncFlag(configuredStandaloneVlmUrl);
    }
    const host = window.location.hostname;
    return `https://${host}:8090/?xcloud_sync=1`;
  }, [configuredStandaloneVlmUrl, withSyncFlag]);

  const selectedEquipment = useMemo(
    () => equipments.find((item) => item.id === selectedEquipmentId) ?? null,
    [equipments, selectedEquipmentId],
  );

  const parsedSummary = useMemo(() => {
    if (!rawJsonParsed) {
      return null;
    }
    const risk = readString(rawJsonParsed.risk_level) ?? readString(rawJsonParsed.overall_risk_level) ?? "moderate";
    const scene = readString(rawJsonParsed.scene) ?? "diagnosis";
    const findings = readString(rawJsonParsed.anomaly_summary) ?? readString(rawJsonParsed.findings_summary) ?? "無摘要欄位";

    const actionNode = rawJsonParsed.recommended_actions ?? rawJsonParsed.work_items;
    const actionCount = Array.isArray(actionNode) ? actionNode.length : 0;

    return { risk, scene, findings, actionCount };
  }, [rawJsonParsed]);

  const parseRawJson = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setRawJsonParsed(null);
      setRawJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isRecord(parsed)) {
        setRawJsonParsed(null);
        setRawJsonError("JSON 需為物件格式（{...}），不能是陣列或純文字。");
        return;
      }
      setRawJsonParsed(parsed);
      setRawJsonError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "JSON 格式錯誤";
      setRawJsonParsed(null);
      setRawJsonError(`無法解析 JSON：${message}`);
    }
  }, []);

  const stopStandaloneMonitor = useCallback(() => {
    if (standaloneMonitorRef.current != null) {
      window.clearInterval(standaloneMonitorRef.current);
      standaloneMonitorRef.current = null;
    }
  }, []);

  const startStandaloneMonitor = useCallback(() => {
    stopStandaloneMonitor();
    standaloneMonitorRef.current = window.setInterval(() => {
      const popup = standaloneWindowRef.current;
      if (!popup) {
        setStandaloneState("unknown");
        return;
      }
      if (popup.closed) {
        setStandaloneState("closed");
        standaloneWindowRef.current = null;
        stopStandaloneMonitor();
      } else {
        setStandaloneState("opened");
      }
    }, 1000);
  }, [stopStandaloneMonitor]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await vlmApi.status();
      setStatus(response.data);
    } catch {
      setStatus({
        webui_ok: false,
        llm_ok: false,
        webui_url: VLM_URL,
        llm_url: "http://localhost:8080",
        model: null,
      });
    } finally {
      setStatusLoading(false);
    }
  }, [VLM_URL]);

  const loadEquipments = useCallback(async () => {
    setEquipmentLoading(true);
    try {
      const response = await dashboardApi.getEquipment();
      setEquipments(response.data ?? []);
    } catch {
      setEquipments([]);
    } finally {
      setEquipmentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadEquipments();
  }, [loadStatus, loadEquipments]);

  useEffect(() => () => {
    stopStandaloneMonitor();
  }, [stopStandaloneMonitor]);

  const handleRefresh = async () => {
    setIframeKey((c) => c + 1);
    await loadStatus();
  };

  const handleStartSession = () => {
    const newSessionId = `vlm-${Date.now()}`;
    const startedAt = new Date().toISOString();
    setSessionId(newSessionId);
    setSessionState("active");
    setSessionStartedAt(startedAt);
    setSessionEndedAt(null);
    setReportId(null);
    toast.success("巡檢會話已建立，可開始外部視窗巡檢。");
  };

  const handleEndSession = () => {
    if (sessionState !== "active") {
      toast("目前沒有進行中的會話。");
      return;
    }
    setSessionState("ended");
    setSessionEndedAt(new Date().toISOString());
    toast.success("巡檢會話已標記為結束，可回寫 JSON 產生報告。");
  };

  const handleOpenStandalone = () => {
    if (sessionState === "idle") {
      handleStartSession();
    }
    const standaloneVlmUrl = resolveStandaloneVlmUrl();

    const existingPopup = standaloneWindowRef.current;
    if (existingPopup && !existingPopup.closed) {
      let popupToFocus: Window = existingPopup;
      try {
        if (existingPopup.location.href !== standaloneVlmUrl) {
          existingPopup.location.href = standaloneVlmUrl;
        }
      } catch {
        const replacement = window.open(standaloneVlmUrl, "_blank", "noopener,noreferrer");
        if (!replacement) {
          setStandaloneState("blocked");
          toast.error("瀏覽器阻擋了新視窗，請允許彈出視窗後再試。", { duration: 4500 });
          return;
        }
        standaloneWindowRef.current = replacement;
        popupToFocus = replacement;
      }
      setStandaloneState("opened");
      popupToFocus.focus();
      startStandaloneMonitor();
      return;
    }

    const popup = window.open(standaloneVlmUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      setStandaloneState("blocked");
      toast.error("瀏覽器阻擋了新視窗，請允許彈出視窗後再試。", { duration: 4500 });
      return;
    }

    standaloneWindowRef.current = popup;
    setStandaloneState("opened");
    setStandaloneOpenedAt(new Date().toISOString());
    popup.focus();
    startStandaloneMonitor();
  };

  const handleCompare = async () => {
    if (!compareQuery.trim()) return;
    setComparing(true);
    setCompareResult(null);
    try {
      const res = await ragApi.query({ question: compareQuery, top_k: 5 });
      setCompareResult({ answer: res.data.answer, sources: res.data.sources });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "知識庫比對失敗");
    } finally {
      setComparing(false);
    }
  };

  const handleSaveSession = async () => {
    if (rawJsonError) {
      toast.error("請先修正 JSON 格式後再儲存報告。");
      return;
    }

    setSaving(true);
    try {
      const activeSessionId = sessionId ?? `vlm-${Date.now()}`;
      const capturedAt = sessionEndedAt ?? new Date().toISOString();

      if (!sessionId) {
        setSessionId(activeSessionId);
        setSessionStartedAt(capturedAt);
      }

      const response = await reportsApi.captureVlmSession({
        session_id: activeSessionId,
        source: "vlm-webui",
        captured_at: capturedAt,
        raw_vlm_json: rawJsonParsed ?? undefined,
        equipment_id: selectedEquipment?.id,
        equipment_name: selectedEquipment?.name,
        operator_note: operatorNote.trim() || undefined,
      });

      if (sessionState !== "ended") {
        setSessionState("ended");
      }
      if (!sessionEndedAt) {
        setSessionEndedAt(capturedAt);
      }

      setReportId(response.data.id);
      if (rawJsonParsed) {
        toast.success("巡檢記錄與 JSON 已轉為維護報告。");
      } else {
        toast.success("巡檢報告已建立（資料不完整，可後續補登 JSON）。");
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.detail ?? "儲存失敗，請確認後端服務是否運作。");
    } finally {
      setSaving(false);
    }
  };

  const standaloneLabel = {
    opened: "Opened",
    closed: "Closed",
    unknown: "Unknown",
    blocked: "Blocked",
  }[standaloneState];

  const standaloneTone = {
    opened: "status-pill-ok",
    closed: "status-pill-warn",
    unknown: "status-pill-warn",
    blocked: "status-pill-danger",
  }[standaloneState];

  return (
    <div className="space-y-4">
      <section className="panel-soft rounded-[32px] p-4 sm:p-5">
        <div className="flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/15">
              <Camera className="h-4.5 w-4.5 text-brand-300" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Live Inspection Surface</p>
              <h1 className="mt-0.5 text-xl font-semibold text-white">現場影像與推論畫面</h1>
            </div>
            <div className="ml-2 hidden items-center gap-2 sm:flex">
              <StatusDot ok={status?.webui_ok ?? false} loading={statusLoading} label="WebUI" />
              <StatusDot ok={status?.llm_ok ?? false} loading={statusLoading} label="引擎" />
              <span className={`status-pill ${standaloneTone}`}>視窗 {standaloneLabel}</span>
              {reportId && <span className="status-pill status-pill-ok">報告 {reportId.slice(0, 8)}</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={handleRefresh} className="secondary-button" disabled={statusLoading}>
              <RefreshCw className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
              重載
            </button>
            <button onClick={handleOpenStandalone} className="secondary-button">
              <ExternalLink className="h-4 w-4" />
              獨立視窗
            </button>
            <button
              onClick={sessionState === "active" ? handleEndSession : handleStartSession}
              className="secondary-button"
            >
              {sessionState === "active" ? "結束會話" : "建立會話"}
            </button>
            <button
              onClick={() => setPeopleOverlayEnabled((value) => !value)}
              className={`secondary-button ${peopleOverlayEnabled ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100" : ""}`}
            >
              <Users className="h-4 w-4" />
              {peopleOverlayEnabled ? "關閉人員分析" : "開啟人員分析"}
            </button>
            <button onClick={handleSaveSession} disabled={saving} className="primary-button">
              <Save className="h-4 w-4" />
              {saving ? "轉換中..." : "儲存為報告"}
            </button>
            <button
              onClick={() => setShowCompare((v) => !v)}
              className={`secondary-button ${showCompare ? "border-brand-500/50 bg-brand-500/15 text-brand-200" : ""}`}
            >
              <Database className="h-4 w-4" />
              知識庫比對
            </button>
          </div>
        </div>

        <div
          className="relative mt-4 overflow-hidden rounded-[28px] border border-white/8 bg-slate-950/70"
          style={{ height: "clamp(560px, 72vh, 920px)" }}
        >
          <iframe
            key={iframeKey}
            src={VLM_MINIMAL_URL}
            className="h-full w-full border-0"
            title="live-vlm-webui"
            allow="camera; microphone; autoplay; clipboard-write"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
          />

          {/* 極簡文字同步浮層 */}
          <VlmSimpleOverlay />
          <VlmPeopleOverlay enabled={peopleOverlayEnabled} onSnapshotChange={setPeopleSnapshot} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Session State</p>
              <span className={`status-pill ${sessionState === "active" ? "status-pill-ok" : sessionState === "ended" ? "status-pill-warn" : "status-pill-danger"}`}>
                {sessionState.toUpperCase()}
              </span>
            </div>
            <p className="mt-3 break-all text-sm font-semibold text-white">{sessionId ?? "尚未建立"}</p>
            <p className="mt-1 text-xs text-slate-400">Start: {sessionStartedAt ? new Date(sessionStartedAt).toLocaleString("zh-TW") : "-"}</p>
            <p className="mt-1 text-xs text-slate-400">End: {sessionEndedAt ? new Date(sessionEndedAt).toLocaleString("zh-TW") : "-"}</p>
          </div>

          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Standalone Window</p>
              <span className={`status-pill ${standaloneTone}`}>{standaloneLabel}</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-white">{STANDALONE_VLM_URL}</p>
            <p className="mt-1 text-xs text-slate-400">Opened At: {standaloneOpenedAt ? new Date(standaloneOpenedAt).toLocaleString("zh-TW") : "-"}</p>
          </div>

          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Report Bridge</p>
              <span className={`status-pill ${rawJsonError ? "status-pill-danger" : rawJsonParsed ? "status-pill-ok" : "status-pill-warn"}`}>
                {rawJsonError ? "Invalid JSON" : rawJsonParsed ? "Ready" : "Waiting"}
              </span>
            </div>
            <p className="mt-3 text-sm font-semibold text-white">{rawJsonParsed ? "已解析 raw_vlm_json" : "尚未貼上 JSON"}</p>
            <p className="mt-1 text-xs text-slate-400">半自動回寫：貼上 JSON 後送出 /capture-vlm-session</p>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] border border-cyan-400/15 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10">
                <Users className="h-4 w-4 text-cyan-300" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">People Analysis</p>
                <h3 className="mt-1 text-base font-semibold text-white">人員分析與行為提示</h3>
                <p className="mt-1 text-xs text-cyan-300">{PEOPLE_ANALYSIS_MODE_LABEL}</p>
              </div>
            </div>
            <span className={`status-pill ${peopleOverlayEnabled ? "status-pill-ok" : "status-pill-warn"}`}>
              {peopleOverlayEnabled ? "Overlay On" : "Overlay Off"}
            </span>
          </div>

          {peopleSnapshot ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatusTile
                    label="人員數"
                    statusLabel={peopleSnapshot.source === "structured" ? "Structured" : "Heuristic"}
                    value={`${peopleSnapshot.personCount} 人`}
                    detail="沿用目前 localStorage 同步結果"
                    tone="status-pill-ok"
                  />
                  <StatusTile
                    label="主要動作"
                    statusLabel="Action"
                    value={peopleSnapshot.personInfos[0] ? PEOPLE_ACTION_LABELS[peopleSnapshot.personInfos[0].action] : "未提供"}
                    detail={peopleSnapshot.personInfos[0]?.actionBasis ?? "尚未偵測到可用線索"}
                    tone="status-pill-warn"
                  />
                  <StatusTile
                    label="性別推測"
                    statusLabel="Experimental"
                    value={peopleSnapshot.personInfos[0] ? PEOPLE_GENDER_LABELS[peopleSnapshot.personInfos[0].gender] : "未提供"}
                    detail={peopleSnapshot.personInfos[0]?.genderBasis ?? "heuristic only"}
                    tone="status-pill-warn"
                  />
                </div>

                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">實驗性說明</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Preview / Heuristic：本區塊僅做輔助判讀，不代表即時姿態模型已接入。若目前來源僅有 VLM 文字結果，動作與性別會以關鍵字 heuristic 呈現。
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">高優先行為</p>
                  {peopleSnapshot.behaviors.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {peopleSnapshot.behaviors.slice(0, 6).map((item) => (
                        <span
                          key={`${item.type}-${item.timestamp}`}
                          className={`rounded-full border px-2.5 py-1 text-[11px] ${
                            item.risk === "critical"
                              ? "border-red-400/30 bg-red-500/10 text-red-200"
                              : item.risk === "warning"
                                ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
                                : "border-slate-400/20 bg-white/5 text-slate-200"
                          }`}
                        >
                          {item.nameZh ?? item.type}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">目前尚未擷取到人員行為提示。</p>
                  )}
                </div>

                {peopleSnapshot.sourceText && (
                  <div className="rounded-[18px] border border-white/8 bg-slate-950/40 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">來源摘錄</p>
                    <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-300">
                      {peopleSnapshot.sourceText}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm text-slate-400">
                目前尚未從 live VLM 同步結果中擷取到人員資訊。開啟獨立視窗後進行人員相關巡檢，overlay 會沿用既有 localStorage 橋接自動更新。
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-[28px] border border-white/10 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">JSON Writeback</p>
              <h3 className="mt-1 text-base font-semibold text-white">raw_vlm_json 回寫面板</h3>
            </div>
            <span className="status-pill status-pill-warn">半自動橋接</span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="text-xs text-slate-400">選擇設備（可選）</label>
              <select
                value={selectedEquipmentId}
                onChange={(e) => setSelectedEquipmentId(e.target.value)}
                className="w-full rounded-[14px] border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-500/50"
              >
                <option value="">未指定設備</option>
                {equipments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </select>
              {equipmentLoading && <p className="text-xs text-slate-500">載入設備清單中…</p>}

              <label className="text-xs text-slate-400">操作員備註（可選）</label>
              <textarea
                value={operatorNote}
                onChange={(e) => setOperatorNote(e.target.value)}
                rows={4}
                placeholder="例如：本次巡檢於夜班完成，鏡頭角度偏左。"
                className="w-full rounded-[14px] border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-500/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400">貼上 raw_vlm_json（可留空，將建立資料不完整報告）</label>
              <textarea
                value={rawJsonInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setRawJsonInput(value);
                  parseRawJson(value);
                }}
                rows={10}
                placeholder='{"risk_level": "moderate", "anomaly_summary": "..."}'
                className={`w-full rounded-[14px] border px-3 py-2.5 text-sm text-white outline-none ${rawJsonError ? "border-red-400/70 bg-red-950/20" : "border-white/10 bg-slate-950/50 focus:border-brand-500/50"}`}
              />
              {rawJsonError
                ? <p className="text-xs text-red-300">{rawJsonError}</p>
                : <p className="text-xs text-slate-500">JSON 合法時會自動顯示摘要。</p>}
            </div>
          </div>

          {parsedSummary && (
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <StatusTile label="風險等級" statusLabel="Parsed" value={parsedSummary.risk.toUpperCase()} detail="risk_level / overall_risk_level" tone="status-pill-ok" />
              <StatusTile label="場景" statusLabel="Parsed" value={parsedSummary.scene} detail="scene" tone="status-pill-ok" />
              <StatusTile label="異常摘要" statusLabel="Parsed" value={parsedSummary.findings} detail="anomaly_summary / findings_summary" tone="status-pill-ok" />
              <StatusTile label="建議行動" statusLabel="Parsed" value={`${parsedSummary.actionCount} 筆`} detail="recommended_actions / work_items" tone="status-pill-ok" />
            </div>
          )}
        </div>

        {showCompare && (
          <div className="mt-4 rounded-[28px] border border-white/10 bg-slate-950/60 p-5">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Knowledge Compare</p>
                <h3 className="mt-1 text-base font-semibold text-white">知識庫比對</h3>
              </div>
              <button
                onClick={() => { setShowCompare(false); setCompareResult(null); }}
                className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={compareQuery}
                onChange={(e) => setCompareQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCompare()}
                placeholder="描述異常現象，查詢知識庫中的相關維修資訊…"
                className="flex-1 rounded-[16px] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
              />
              <button
                onClick={handleCompare}
                disabled={comparing || !compareQuery.trim()}
                className="primary-button whitespace-nowrap"
              >
                {comparing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {comparing ? "比對中…" : "比對"}
              </button>
            </div>

            {compareResult && (
              <div className="mt-4 space-y-3">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">知識庫回應</p>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">
                    {compareResult.answer}
                  </div>
                </div>
                {compareResult.sources.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">參考來源</p>
                    {compareResult.sources.map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-[16px] border border-white/8 bg-slate-950/30 px-4 py-2.5">
                        <p className="truncate text-sm text-slate-300">{s.filename}</p>
                        {s.score != null && (
                          <span className="table-chip whitespace-nowrap">{(s.score * 100).toFixed(0)}%</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Collapsible
          kicker="System"
          title="推論引擎狀態"
          icon={<Radar className="h-4 w-4 text-slate-300" />}
          defaultOpen={false}
        >
          <div className="grid grid-cols-2 gap-3">
            <StatusTile label="VLM WebUI" statusLabel={status?.webui_ok ? "Ready" : "Offline"} value={status?.webui_ok ? "Online" : "Offline"} detail={status?.webui_url ?? VLM_URL} tone={status?.webui_ok ? "status-pill-ok" : "status-pill-danger"} />
            <StatusTile label="推論引擎" statusLabel={status?.llm_ok ? "Ready" : "Offline"} value={status?.llm_ok ? "Gemma Ready" : "Engine Offline"} detail={status?.model ?? "Gemma 4 E2B"} tone={status?.llm_ok ? "status-pill-ok" : "status-pill-danger"} />
            <StatusTile label="模型端點" statusLabel="API" value="http://llama-cpp:8080" detail="OpenAI 相容 API" tone="status-pill-warn" />
            <StatusTile label="報告儲存" statusLabel={reportId ? "Ready" : "Standby"} value={reportId ? `已建立 ${reportId.slice(0, 8)}` : "等待巡檢結果"} detail="支援轉出維護報告" tone={reportId ? "status-pill-ok" : "status-pill-warn"} />
          </div>
        </Collapsible>

        <Collapsible
          kicker="Preflight"
          title="巡檢前確認"
          icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />}
          defaultOpen={false}
        >
          <div className="space-y-2.5">
            {CHECKLIST.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-[16px] border border-white/8 bg-slate-950/30 px-3.5 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                <p className="text-xs leading-5 text-slate-300">{item}</p>
              </div>
            ))}
          </div>
        </Collapsible>

        <Collapsible
          kicker="Inspection Scenarios"
          title="建議巡檢場景"
          icon={<Info className="h-4 w-4 text-brand-300" />}
          defaultOpen={false}
        >
          <div className="space-y-2.5">
            {INSPECTION_SCENARIOS.map((s, i) => (
              <div key={s.title} className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="table-chip">0{i + 1}</span>
                  <p className="text-xs font-semibold text-white">{s.title}</p>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">{s.detail}</p>
              </div>
            ))}
            <div className="rounded-[18px] border border-amber-400/15 bg-amber-500/8 p-3.5">
              <div className="flex items-start gap-2.5">
                <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-300" />
                <p className="text-xs leading-5 text-slate-300">
                  建立會話 → 外部視窗巡檢 → 貼上 JSON → 儲存報告，完成半自動整合流程。
                </p>
              </div>
            </div>
          </div>
        </Collapsible>
      </section>
    </div>
  );
}

function StatusDot({ ok, loading, label }: { ok: boolean; loading: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse bg-slate-500" : ok ? "bg-emerald-400" : "bg-red-500"}`} />
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  );
}

function StatusTile({ label, statusLabel, value, detail, tone }: {
  label: string; statusLabel: string; value: string; detail: string; tone: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
        <span className={`status-pill ${tone}`}>{statusLabel}</span>
      </div>
      <p className="mt-3 break-all text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}
