"use client";

import { useEffect, useState } from "react";
import {
  ACTION_ZH,
  GENDER_ZH,
  extractPeopleAnalysisFromPayload,
  type PeopleAnalysisSnapshot,
} from "@/hooks/useBehaviorDetector";

const STORAGE_KEY = "xcloud.live_vlm.latest_result";

export function VlmPeopleOverlay({
  enabled = true,
  onSnapshotChange,
}: {
  enabled?: boolean;
  onSnapshotChange?: (snapshot: PeopleAnalysisSnapshot | null) => void;
}) {
  const [snapshot, setSnapshot] = useState<PeopleAnalysisSnapshot | null>(null);
  const [timestamp, setTimestamp] = useState<string>("");

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setTimestamp("");
      onSnapshotChange?.(null);
      return;
    }

    const sync = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as { payload?: unknown; timestamp?: string };
        if (!parsed.payload || parsed.timestamp === timestamp) {
          return;
        }

        const next = extractPeopleAnalysisFromPayload(parsed.payload);
        setSnapshot(next.personCount > 0 || next.behaviors.length > 0 ? next : null);
        setTimestamp(parsed.timestamp ?? "");
        onSnapshotChange?.(next.personCount > 0 || next.behaviors.length > 0 ? next : null);
      } catch {
        // Ignore malformed sync payloads and keep the last valid snapshot.
      }
    };

    sync();
    const interval = window.setInterval(sync, 1500);
    return () => window.clearInterval(interval);
  }, [enabled, onSnapshotChange, timestamp]);

  if (!enabled || !snapshot) {
    return null;
  }

  const primaryPerson = snapshot.personInfos[0];
  const visibleBehaviors = snapshot.behaviors.slice(0, 3);

  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 w-[min(360px,calc(100%-2rem))]">
      <div className="rounded-2xl border border-cyan-400/20 bg-slate-950/80 p-4 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400" />
          <span className="text-xs font-medium text-cyan-300">人員分析</span>
          <span className="ml-auto text-[11px] text-slate-500">
            {timestamp ? new Date(timestamp).toLocaleTimeString("zh-TW") : ""}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">
            {snapshot.personCount} 人
          </span>
          {primaryPerson && (
            <>
              <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-200">
                性別: {GENDER_ZH[primaryPerson.gender]}
              </span>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                動作: {ACTION_ZH[primaryPerson.action]}
              </span>
            </>
          )}
        </div>

        {visibleBehaviors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {visibleBehaviors.map((item) => (
              <span
                key={`${item.type}-${item.timestamp}`}
                className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100"
              >
                {item.nameZh}
              </span>
            ))}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-5 text-slate-400">
          性別推測為實驗性 heuristic only，僅供輔助參考，不作正式判定。
        </p>
      </div>
    </div>
  );
}
