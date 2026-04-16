'use client';
import { useEffect, useState } from 'react';

export function VlmSimpleOverlay() {
  const [text, setText] = useState<string>('');
  const [timestamp, setTimestamp] = useState<string>('');

  useEffect(() => {
    const checkStorage = () => {
      try {
        const data = localStorage.getItem('xcloud.live_vlm.latest_result');
        if (!data) return;

        const parsed = JSON.parse(data);
        if (parsed.payload && parsed.timestamp !== timestamp) {
          // 優先顯示 anomaly_summary，否則顯示 raw_text
          const displayText =
            parsed.payload.anomaly_summary ||
            parsed.payload.raw_text ||
            JSON.stringify(parsed.payload, null, 2).slice(0, 200) + '...';

          setText(displayText);
          setTimestamp(parsed.timestamp);
        }
      } catch (e) {
        // 忽略錯誤，繼續輪詢
      }
    };

    // 立即檢查一次 + 每 1.5 秒輪詢（夠快又不會太頻繁）
    checkStorage();
    const interval = setInterval(checkStorage, 1500);

    return () => clearInterval(interval);
  }, [timestamp]);

  // 调试：始终显示（即使没有数据）
  const displayText = text || '等待 VLM 分析结果...';
  const isWaiting = !text;

  return (
    <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-10">
      <div className="mx-6 mb-6">
        <div className="bg-black/75 backdrop-blur-xl border border-white/10 rounded-2xl p-4 text-sm text-white shadow-xl">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-xs text-green-400 font-medium">
              {isWaiting ? '等待分析' : '即時 VLM 分析'}
            </span>
            <span className="text-xs text-white/50 ml-auto">
              {timestamp ? new Date(timestamp).toLocaleTimeString('zh-TW') : ''}
            </span>
          </div>
          <p className="leading-relaxed line-clamp-3">{displayText}</p>
        </div>
      </div>
    </div>
  );
}
