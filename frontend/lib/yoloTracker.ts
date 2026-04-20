export interface TrackCandidate {
  x: number;
  y: number;
  w: number;
  h: number;
  classId: number;
  score?: number;
  className?: string;
  classEn?: string;
}

export interface TrackedObject extends TrackCandidate {
  trackId: number;
  age: number;
  hits: number;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function iou(a: Pick<TrackCandidate, "x" | "y" | "w" | "h">, b: Pick<TrackCandidate, "x" | "y" | "w" | "h">) {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const intersection = iw * ih;
  const union = a.w * a.h + b.w * b.h - intersection;

  return union > 0 ? intersection / union : 0;
}

export class SortTracker {
  private nextTrackId = 1;
  private tracks = new Map<number, TrackedObject>();

  constructor(
    private readonly minIou = 0.2,
    private readonly maxAge = 15,
  ) {}

  update(detections: TrackCandidate[]): TrackedObject[] {
    const matchedTrackIds = new Set<number>();
    const results: TrackedObject[] = [];

    for (const detection of detections) {
      let bestTrackId: number | null = null;
      let bestIou = 0;

      for (const [trackId, track] of this.tracks.entries()) {
        if (matchedTrackIds.has(trackId) || track.classId !== detection.classId) {
          continue;
        }

        const score = iou(track, detection);
        if (score > bestIou) {
          bestIou = score;
          bestTrackId = trackId;
        }
      }

      if (bestTrackId != null && bestIou >= this.minIou) {
        const prev = this.tracks.get(bestTrackId)!;
        const updated: TrackedObject = {
          ...prev,
          ...detection,
          score: detection.score ?? prev.score,
          trackId: bestTrackId,
          age: 0,
          hits: prev.hits + 1,
        };
        this.tracks.set(bestTrackId, updated);
        matchedTrackIds.add(bestTrackId);
        results.push(updated);
        continue;
      }

      const created: TrackedObject = {
        ...detection,
        trackId: this.nextTrackId++,
        age: 0,
        hits: 1,
      };
      this.tracks.set(created.trackId, created);
      matchedTrackIds.add(created.trackId);
      results.push(created);
    }

    for (const [trackId, track] of this.tracks.entries()) {
      if (matchedTrackIds.has(trackId)) {
        continue;
      }
      const aged = { ...track, age: track.age + 1 };
      if (aged.age > this.maxAge) {
        this.tracks.delete(trackId);
      } else {
        this.tracks.set(trackId, aged);
      }
    }

    return results.sort((a, b) => a.trackId - b.trackId);
  }

  reset() {
    this.tracks.clear();
    this.nextTrackId = 1;
  }
}

export function drawTrackIds(
  canvas: HTMLCanvasElement,
  tracks: TrackedObject[],
  color = "#38bdf8",
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.save();
  ctx.font = "12px sans-serif";
  ctx.lineWidth = 1.5;

  for (const track of tracks) {
    const x = clamp(track.x) * canvas.width;
    const y = clamp(track.y) * canvas.height;
    const text = `#${track.trackId}`;
    const width = ctx.measureText(text).width + 10;
    const boxHeight = 18;

    ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, Math.max(0, y - boxHeight - 2), width, boxHeight, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillText(text, x + 5, Math.max(12, y - 8));
  }

  ctx.restore();
}
