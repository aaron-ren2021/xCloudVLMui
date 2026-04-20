"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SortTracker, type TrackCandidate, type TrackedObject } from "@/lib/yoloTracker";

export function useYoloTracker() {
  const trackerRef = useRef<SortTracker | null>(null);
  const [tracked, setTracked] = useState<TrackedObject[]>([]);

  const tracker = useMemo(() => {
    if (!trackerRef.current) {
      trackerRef.current = new SortTracker();
    }
    return trackerRef.current;
  }, []);

  const update = useCallback((detections: TrackCandidate[]) => {
    const next = tracker.update(detections);
    setTracked(next);
    return next;
  }, [tracker]);

  const reset = useCallback(() => {
    tracker.reset();
    setTracked([]);
  }, [tracker]);

  return {
    tracked,
    update,
    reset,
  };
}
