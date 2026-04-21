"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  Save,
  ScanLine,
  Server,
  Sliders,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { settingsApi } from "@/lib/api";
import type { SystemSettings } from "@/types";

const DEFAULT_MODEL = "gemma-4-e2b-it";
const SWITCH_OPTIONS = [
  { id: "gemma-4-e2b-it", label: "Gemma 4 E2B (Q4_K_S, Default)" },
  { id: "gemma-4-e2b-it-q4-k-m", label: "Gemma 4 E2B (Q4_K_M)" },
  { id: "gemma-4-e4b-it", label: "Gemma 4 E4B (Q4_K_M)" },
] as const;

const DEFAULT: SystemSettings = {
  ocr_engine:       "vlm",
  embed_model_url:  "",
  embed_model_name: DEFAULT_MODEL,
  llm_model_url:    "",
  llm_model_name:   DEFAULT_MODEL,
  chunk_size:       800,
  chunk_overlap:    100,
  rag_top_k:        5,
};

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  eyebrow,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-soft rounded-[30px] p-5 sm:p-6">
      <div className="flex items-start gap-4 border-b border-white/8 pb-5">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-brand-400/20 bg-brand-400/10">
          <Icon className="h-6 w-6 text-brand-300" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-white">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-[16px] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20";

const numInputCls = inputCls + " [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT);
  const [saving, setSaving]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [resetting, setReset]   = useState(false);
  const [saved, setSaved]       = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptions, setModelOptions]   = useState<string[]>([DEFAULT_MODEL]);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string>("gemma-4-e2b-it");
  const [lastSwitchCommand, setLastSwitchCommand] = useState<string>("");

  const refreshModelOptions = useCallback(async (prefer: string[] = []) => {
    setLoadingModels(true);
    try {
      const res = await settingsApi.models();
      const merged = [...prefer, res.data.default_model, ...res.data.models];
      setModelOptions(Array.from(new Set(merged.filter(Boolean))));
    } catch {
      setModelOptions((prev) => Array.from(new Set([...prefer, DEFAULT_MODEL, ...prev])));
      toast.error("模型清單取得失敗，仍可手動輸入模型 ID");
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await settingsApi.get();
      setSettings(res.data);
      await refreshModelOptions([res.data.llm_model_name, res.data.embed_model_name]);
    } catch {
      toast.error("載入設定失敗");
    } finally {
      setLoading(false);
    }
  }, [refreshModelOptions]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await settingsApi.update(settings as unknown as Record<string, unknown>);
      setSettings(res.data);
      await refreshModelOptions([res.data.llm_model_name, res.data.embed_model_name]);
      setSaved(true);
      toast.success("設定已儲存");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setReset(true);
    try {
      const res = await settingsApi.reset();
      setSettings(res.data);
      await refreshModelOptions([res.data.llm_model_name, res.data.embed_model_name]);
      toast.success("已重置為預設值");
    } catch {
      toast.error("重置失敗");
    } finally {
      setReset(false);
    }
  };

  const set = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="panel-grid overflow-hidden rounded-[32px] p-6 sm:p-7 lg:p-8">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="section-kicker">System Config</div>
            <h1 className="display-title mt-4 text-3xl leading-tight sm:text-[40px]">
              系統設定
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              設定 OCR 引擎、向量嵌入模型、語言模型端點與 RAG 推論參數。
              修改後點擊「儲存設定」即時生效。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleReset}
              disabled={resetting}
              className="secondary-button"
            >
              {resetting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              重置預設
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="primary-button"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "儲存中…" : saved ? "已儲存" : "儲存設定"}
            </button>
          </div>
        </div>
      </section>
      {switchingModel && (
        <section className="rounded-[20px] border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          模型切換設定更新中。llama.cpp 重新載入期間，API 可能短暫中斷（約 30–90 秒）。
        </section>
      )}
      {!!lastSwitchCommand && (
        <section className="rounded-[20px] border border-cyan-400/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          已產生服務切換指令：<code className="rounded bg-slate-900/70 px-2 py-1">{lastSwitchCommand}</code>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* OCR Settings */}
        <SectionCard
          icon={ScanLine}
          title="OCR 引擎設定"
          subtitle="設定圖片文字辨識的推論方式"
          eyebrow="OCR Engine"
        >
          <Field
            label="OCR 引擎"
            hint="vlm：使用本地 Gemma VLM 視覺模型進行 OCR（推薦）；disabled：停用圖片 OCR 功能"
          >
            <div className="flex gap-3">
              {(["vlm", "disabled"] as const).map((engine) => (
                <button
                  key={engine}
                  onClick={() => set("ocr_engine", engine)}
                  className={`flex-1 rounded-[16px] border py-3 text-sm font-semibold transition-colors ${
                    settings.ocr_engine === engine
                      ? "border-brand-500/50 bg-brand-500/20 text-white"
                      : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {engine === "vlm" ? "VLM（Gemma）" : "停用"}
                </button>
              ))}
            </div>
          </Field>

          {settings.ocr_engine === "vlm" && (
            <div className="rounded-[20px] border border-emerald-400/15 bg-emerald-400/8 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                <div>
                  <p className="text-sm font-semibold text-white">使用 Gemma 4 E2B VLM</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    透過 llama.cpp 本地推論進行圖片文字辨識，完全離線，無需外部服務。
                    上傳圖片時將自動呼叫視覺模型提取所有可辨識文字後嵌入知識庫。
                  </p>
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Embedding Settings */}
        <SectionCard
          icon={Zap}
          title="向量嵌入模型"
          subtitle="設定文字向量化的模型端點"
          eyebrow="Embedding Model"
        >
          <Field
            label="嵌入模型端點 URL"
            hint="留空使用系統預設值（llama-cpp:8080）"
          >
            <input
              type="text"
              className={inputCls}
              placeholder="http://llama-cpp:8080（留空使用預設）"
              value={settings.embed_model_url}
              onChange={(e) => set("embed_model_url", e.target.value)}
            />
          </Field>
          <Field
            label="嵌入模型名稱"
            hint={`可從下拉建議快速切換，也可手動輸入。預設：${DEFAULT_MODEL}`}
          >
            <input
              type="text"
              className={inputCls}
              placeholder="gemma-4-e2b-it"
              list="embed-model-options"
              value={settings.embed_model_name}
              onChange={(e) => set("embed_model_name", e.target.value)}
            />
            <datalist id="embed-model-options">
              {modelOptions.map((model) => (
                <option key={`embed-${model}`} value={model} />
              ))}
            </datalist>
          </Field>
        </SectionCard>

        {/* LLM Settings */}
        <SectionCard
          icon={Server}
          title="語言模型設定"
          subtitle="設定推論生成的模型端點"
          eyebrow="LLM Endpoint"
        >
          <Field
            label="語言模型端點 URL"
            hint="留空使用系統預設值（llama-cpp:8080）"
          >
            <input
              type="text"
              className={inputCls}
              placeholder="http://llama-cpp:8080（留空使用預設）"
              value={settings.llm_model_url}
              onChange={(e) => set("llm_model_url", e.target.value)}
            />
          </Field>
          <Field
            label="語言模型名稱"
            hint={`可從下拉建議快速切換，也可手動輸入。預設：${DEFAULT_MODEL}`}
          >
            <input
              type="text"
              className={inputCls}
              placeholder="gemma-4-e2b-it"
              list="llm-model-options"
              value={settings.llm_model_name}
              onChange={(e) => set("llm_model_name", e.target.value)}
            />
            <datalist id="llm-model-options">
              {modelOptions.map((model) => (
                <option key={`llm-${model}`} value={model} />
              ))}
            </datalist>
          </Field>
          <button
            onClick={() => refreshModelOptions([settings.llm_model_name, settings.embed_model_name])}
            disabled={loadingModels}
            className="secondary-button w-full"
          >
            {loadingModels ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            重新抓取可用模型（{modelOptions.length}）
          </button>
          <Field
            label="Docker 模型切換"
            hint="會同步更新系統設定，並回傳可執行切換指令（預設推薦 gemma-4-e2b-it）"
          >
            <select
              className={inputCls}
              value={switchTarget}
              onChange={(e) => setSwitchTarget(e.target.value)}
            >
              {SWITCH_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            onClick={async () => {
              setSwitchingModel(true);
              try {
                const res = await settingsApi.switchModel(switchTarget);
                set("llm_model_name", res.data.model_alias);
                set("embed_model_name", res.data.model_alias);
                setLastSwitchCommand(res.data.switch_command);
                toast.success(`已設定目標模型，請在主機執行：${res.data.switch_command}`);
              } catch {
                toast.error("模型切換設定失敗");
              } finally {
                setSwitchingModel(false);
              }
            }}
            disabled={switchingModel}
            className="primary-button w-full"
          >
            {switchingModel ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Server className="h-4 w-4" />
            )}
            套用模型切換（服務層）
          </button>
        </SectionCard>

        {/* RAG Parameters */}
        <SectionCard
          icon={Sliders}
          title="RAG 推論參數"
          subtitle="調整文件切片與語意搜尋設定"
          eyebrow="RAG Parameters"
        >
          <Field
            label="切片大小（字元數）"
            hint="每個文件段落的最大字元數，建議 400–1200"
          >
            <input
              type="number"
              className={numInputCls}
              min={100}
              max={4000}
              step={100}
              value={settings.chunk_size}
              onChange={(e) => set("chunk_size", parseInt(e.target.value) || 800)}
            />
          </Field>
          <Field
            label="切片重疊（字元數）"
            hint="相鄰段落重疊的字元數，避免語意斷裂，建議 50–200"
          >
            <input
              type="number"
              className={numInputCls}
              min={0}
              max={500}
              step={50}
              value={settings.chunk_overlap}
              onChange={(e) => set("chunk_overlap", parseInt(e.target.value) || 100)}
            />
          </Field>
          <Field
            label="語意搜尋回傳數（Top K）"
            hint="每次查詢最多回傳的相關段落數，建議 3–10"
          >
            <input
              type="number"
              className={numInputCls}
              min={1}
              max={20}
              step={1}
              value={settings.rag_top_k}
              onChange={(e) => set("rag_top_k", parseInt(e.target.value) || 5)}
            />
          </Field>

          {/* Preview */}
          <div className="rounded-[20px] border border-white/8 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              目前參數預覽
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {[
                { label: "切片大小", value: settings.chunk_size, unit: "chars" },
                { label: "重疊長度", value: settings.chunk_overlap, unit: "chars" },
                { label: "Top K",  value: settings.rag_top_k,    unit: "段" },
              ].map(({ label, value, unit }) => (
                <div key={label} className="text-center">
                  <p className="font-display text-2xl font-semibold text-white">{value}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{unit}</p>
                  <p className="text-xs text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Save Bar */}
      <div className="sticky bottom-4 z-20">
        <div className="mx-auto max-w-lg rounded-[24px] border border-white/10 bg-slate-900/90 px-6 py-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-400">
              修改後請點擊儲存，設定即時套用至後端。
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="primary-button whitespace-nowrap"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "儲存中…" : saved ? "已儲存" : "儲存設定"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
