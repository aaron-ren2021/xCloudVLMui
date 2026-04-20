"use client";

import { useCallback, useState } from "react";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface PoseKeypoint {
  name: string;
  x: number;
  y: number;
  visibility: number;
}

export interface PoseDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  keypoints: PoseKeypoint[];
}

const COCO_KEYPOINT_NAMES = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKeypoint(raw: unknown, index: number): PoseKeypoint | null {
  if (Array.isArray(raw)) {
    const [x, y, visibility] = raw;
    return {
      name: COCO_KEYPOINT_NAMES[index] ?? `kp_${index}`,
      x: asNumber(x),
      y: asNumber(y),
      visibility: asNumber(visibility, 0),
    };
  }

  if (!isRecord(raw)) {
    return null;
  }

  return {
    name: typeof raw.name === "string" ? raw.name : COCO_KEYPOINT_NAMES[index] ?? `kp_${index}`,
    x: asNumber(raw.x),
    y: asNumber(raw.y),
    visibility: asNumber(raw.visibility ?? raw.v ?? raw.score, 0),
  };
}

export function extractPoseDetectionsFromPayload(payload: unknown): PoseDetection[] {
  if (!isRecord(payload)) {
    return [];
  }

  const source =
    payload.pose_keypoints ??
    payload.pose_detections ??
    payload.poses ??
    payload.pose ??
    null;

  if (!Array.isArray(source)) {
    return [];
  }

  return source.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const keypointsRaw = Array.isArray(entry.keypoints) ? entry.keypoints : [];
    const keypoints = keypointsRaw
      .map((item, index) => normalizeKeypoint(item, index))
      .filter((item): item is PoseKeypoint => !!item);

    if (!keypoints.length) {
      return [];
    }

    const xs = keypoints.map((item) => item.x);
    const ys = keypoints.map((item) => item.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return [{
      x: asNumber(entry.x, minX),
      y: asNumber(entry.y, minY),
      w: asNumber(entry.w, Math.max(0.02, maxX - minX)),
      h: asNumber(entry.h, Math.max(0.02, maxY - minY)),
      score: asNumber(entry.score, 0.5),
      keypoints,
    }];
  });
}

export function poseToDbFormat(poses: PoseDetection[]) {
  return poses.map((pose, personIdx) => ({
    personIdx,
    keypoints: pose.keypoints.map((kp) => ({
      name: kp.name,
      x: kp.x,
      y: kp.y,
      v: kp.visibility,
    })),
  }));
}

export function drawPoseOverlay(
  canvas: HTMLCanvasElement,
  _video: HTMLVideoElement | null,
  poses: PoseDetection[],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const edges: Array<[number, number]> = [
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
  ];

  ctx.save();
  ctx.strokeStyle = "rgba(45, 212, 191, 0.88)";
  ctx.fillStyle = "rgba(45, 212, 191, 0.92)";
  ctx.lineWidth = 2;

  for (const pose of poses) {
    for (const [from, to] of edges) {
      const a = pose.keypoints[from];
      const b = pose.keypoints[to];
      if (!a || !b || a.visibility < 0.25 || b.visibility < 0.25) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }

    for (const keypoint of pose.keypoints) {
      if (keypoint.visibility < 0.25) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(keypoint.x * canvas.width, keypoint.y * canvas.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

export function useYoloPose() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const loadModel = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setStatus("ready");
  }, []);

  const detect = useCallback(async (_input: HTMLVideoElement | HTMLImageElement | ImageBitmap | null) => {
    return [] as PoseDetection[];
  }, []);

  return {
    status,
    error,
    loadModel,
    detect,
  };
}
