"use client";

import { useCallback, useRef, useState } from "react";
import type { PoseDetection } from "@/hooks/useYoloPose";
import type { TrackCandidate, TrackedObject } from "@/lib/yoloTracker";

export type ManufacturingRisk = "critical" | "warning" | "safe" | "info";

export interface YoloDetection extends TrackCandidate {
  score: number;
  className: string;
  classEn: string;
}

export type BehaviorType =
  | "fall_detected"
  | "crowding"
  | "ppe_violation"
  | "hazard_proximity"
  | "vehicle_proximity"
  | "phone_usage"
  | "loitering"
  | "abnormal_posture"
  | "no_person_in_zone"
  | "multiple_persons"
  | "person_running"
  | "person_raising_hand";

export type PersonAction =
  | "standing"
  | "sitting"
  | "walking"
  | "running"
  | "raising_hand"
  | "bending"
  | "squatting"
  | "unknown";

export type GenderEstimate = "male" | "female" | "unknown";

export interface PersonInfo {
  det: YoloDetection;
  pose?: PoseDetection;
  trackId?: number;
  gender: GenderEstimate;
  genderConf: number;
  genderBasis: string;
  action: PersonAction;
  actionConf: number;
  actionBasis: string;
}

export interface BehaviorAlert {
  type: BehaviorType;
  nameZh: string;
  nameEn: string;
  risk: ManufacturingRisk;
  confidence: number;
  description: string;
  trackIds?: number[];
  timestamp: number;
}

export interface PeopleAnalysisSnapshot {
  personInfos: PersonInfo[];
  behaviors: BehaviorAlert[];
  personCount: number;
  sourceText?: string;
  sourceType: "structured" | "text" | "empty";
}

const BEHAVIOR_META: Record<BehaviorType, { nameZh: string; nameEn: string; risk: ManufacturingRisk }> = {
  fall_detected: { nameZh: "跌倒偵測", nameEn: "Fall Detected", risk: "critical" },
  crowding: { nameZh: "人群聚集", nameEn: "Crowding", risk: "warning" },
  ppe_violation: { nameZh: "PPE 缺失", nameEn: "PPE Violation", risk: "critical" },
  hazard_proximity: { nameZh: "危險物品接近", nameEn: "Hazard Proximity", risk: "critical" },
  vehicle_proximity: { nameZh: "車輛人員近距離", nameEn: "Vehicle-Person Proximity", risk: "critical" },
  phone_usage: { nameZh: "工作中使用手機", nameEn: "Phone Usage", risk: "warning" },
  loitering: { nameZh: "長時間滯留", nameEn: "Loitering", risk: "warning" },
  abnormal_posture: { nameZh: "異常姿態", nameEn: "Abnormal Posture", risk: "warning" },
  no_person_in_zone: { nameZh: "無人區域", nameEn: "No Person in Zone", risk: "info" },
  multiple_persons: { nameZh: "多人同場", nameEn: "Multiple Persons", risk: "info" },
  person_running: { nameZh: "人員奔跑", nameEn: "Person Running", risk: "warning" },
  person_raising_hand: { nameZh: "人員舉手", nameEn: "Person Raising Hand", risk: "info" },
};

export const ACTION_ZH: Record<PersonAction, string> = {
  standing: "站立",
  sitting: "坐著",
  walking: "行走",
  running: "奔跑",
  raising_hand: "舉手",
  bending: "彎腰",
  squatting: "蹲下",
  unknown: "偵測中",
};

export const GENDER_ZH: Record<GenderEstimate, string> = {
  male: "男",
  female: "女",
  unknown: "人員",
};

const LOITER_DIST_THRESH = 0.05;
const LOITER_FRAME_THRESH = 60;
const HAZARD_CLOSE_THRESH = 0.156;
const HAZARD_FAR_THRESH = 0.312;
const WALK_SPEED_THRESH = 0.006;
const RUN_SPEED_THRESH = 0.022;

const COCO_ID = {
  PERSON: 0,
  BICYCLE: 1,
  CAR: 2,
  MOTORCYCLE: 3,
  BUS: 5,
  TRUCK: 7,
  BASEBALL_BAT: 34,
  KNIFE: 43,
  SCISSORS: 76,
  CELL_PHONE: 67,
} as const;

interface MovementRecord {
  centerX: number;
  centerY: number;
  velocity: number;
  frameCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function centerDist(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return Math.sqrt(
    (a.x + a.w / 2 - (b.x + b.w / 2)) ** 2 +
    (a.y + a.h / 2 - (b.y + b.h / 2)) ** 2,
  );
}

function makeAlert(type: BehaviorType, confidence: number, description: string, trackIds?: number[]): BehaviorAlert {
  const meta = BEHAVIOR_META[type];
  return {
    type,
    nameZh: meta.nameZh,
    nameEn: meta.nameEn,
    risk: meta.risk,
    confidence,
    description,
    trackIds,
    timestamp: Date.now(),
  };
}

function matchPose(person: YoloDetection, poses: PoseDetection[]) {
  let best: PoseDetection | undefined;
  let bestD = 0.25;
  for (const pose of poses) {
    const distance = centerDist(person, pose);
    if (distance < bestD) {
      bestD = distance;
      best = pose;
    }
  }
  return best;
}

function matchTrack(person: YoloDetection, tracks: TrackedObject[]) {
  let best: TrackedObject | undefined;
  let bestD = 0.15;
  for (const track of tracks) {
    if (track.classId !== COCO_ID.PERSON) {
      continue;
    }
    const distance = centerDist(person, track);
    if (distance < bestD) {
      bestD = distance;
      best = track;
    }
  }
  return best;
}

function estimateGender(keypoints: PoseDetection["keypoints"]) {
  const leftShoulder = keypoints[5];
  const rightShoulder = keypoints[6];
  const leftHip = keypoints[11];
  const rightHip = keypoints[12];

  const shoulderOk = leftShoulder?.visibility >= 0.4 && rightShoulder?.visibility >= 0.4;
  const hipOk = leftHip?.visibility >= 0.4 && rightHip?.visibility >= 0.4;
  if (!shoulderOk || !hipOk) {
    return { gender: "unknown" as GenderEstimate, conf: 0, basis: "關鍵點可見度不足" };
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const hipWidth = Math.abs(leftHip.x - rightHip.x);
  if (hipWidth < 0.01) {
    return { gender: "unknown" as GenderEstimate, conf: 0, basis: "髖部距離過小" };
  }

  const ratio = shoulderWidth / hipWidth;
  const basis = `肩/髖比=${ratio.toFixed(2)}`;

  if (ratio > 1.25) {
    return { gender: "male" as GenderEstimate, conf: Math.min(0.7, 0.45 + (ratio - 1.25) * 0.7), basis };
  }
  if (ratio < 0.95) {
    return { gender: "female" as GenderEstimate, conf: Math.min(0.7, 0.45 + (0.95 - ratio) * 0.7), basis };
  }
  return { gender: "unknown" as GenderEstimate, conf: 0.2, basis: `${basis}（比例居中）` };
}

function detectAction(pose: PoseDetection | undefined, velocity: number) {
  if (!pose) {
    if (velocity > RUN_SPEED_THRESH) {
      return { action: "running" as PersonAction, conf: 0.55, basis: `速度=${velocity.toFixed(3)}` };
    }
    if (velocity > WALK_SPEED_THRESH) {
      return { action: "walking" as PersonAction, conf: 0.5, basis: `速度=${velocity.toFixed(3)}` };
    }
    return { action: "unknown" as PersonAction, conf: 0, basis: "無姿態資料" };
  }

  const keypoints = pose.keypoints;
  const visible = (index: number) => keypoints[index]?.visibility >= 0.35;

  const leftHandUp = visible(9) && visible(5) && keypoints[9].y < keypoints[5].y - 0.04;
  const rightHandUp = visible(10) && visible(6) && keypoints[10].y < keypoints[6].y - 0.04;
  if (leftHandUp || rightHandUp) {
    const which = leftHandUp && rightHandUp ? "雙手" : leftHandUp ? "左手" : "右手";
    return { action: "raising_hand" as PersonAction, conf: 0.85, basis: `${which}腕高於肩膀` };
  }

  const leftSit = visible(11) && visible(13) && Math.abs(keypoints[11].y - keypoints[13].y) < 0.1;
  const rightSit = visible(12) && visible(14) && Math.abs(keypoints[12].y - keypoints[14].y) < 0.1;
  if (leftSit || rightSit) {
    return { action: "sitting" as PersonAction, conf: 0.8, basis: "膝蓋與髖部等高（坐姿）" };
  }

  const leftSquat = visible(13) && visible(15) && Math.abs(keypoints[13].y - keypoints[15].y) < 0.07;
  const rightSquat = visible(14) && visible(16) && Math.abs(keypoints[14].y - keypoints[16].y) < 0.07;
  if (leftSquat && rightSquat) {
    return { action: "squatting" as PersonAction, conf: 0.75, basis: "膝蓋接近腳踝（蹲姿）" };
  }

  const hipCount = (visible(11) ? 1 : 0) + (visible(12) ? 1 : 0);
  if (visible(0) && hipCount > 0) {
    const avgHipY = ((visible(11) ? keypoints[11].y : 0) + (visible(12) ? keypoints[12].y : 0)) / hipCount;
    if (keypoints[0].y > avgHipY + 0.04) {
      return { action: "bending" as PersonAction, conf: 0.75, basis: `頭部 y=${keypoints[0].y.toFixed(2)} > 髖部 y=${avgHipY.toFixed(2)}` };
    }
  }

  if (velocity > RUN_SPEED_THRESH) {
    return { action: "running" as PersonAction, conf: 0.72, basis: `速度=${velocity.toFixed(3)}（>奔跑閾值）` };
  }
  if (velocity > WALK_SPEED_THRESH) {
    return { action: "walking" as PersonAction, conf: 0.68, basis: `速度=${velocity.toFixed(3)}（>行走閾值）` };
  }

  return { action: "standing" as PersonAction, conf: 0.65, basis: "無特殊姿態特徵" };
}

function parseDirectPersonInfos(payload: Record<string, unknown>): PersonInfo[] {
  const source = payload.personInfos ?? payload.person_infos;
  if (!Array.isArray(source)) {
    return [];
  }

  return source.flatMap((entry, index) => {
    if (!isRecord(entry)) {
      return [];
    }

    const gender = typeof entry.gender === "string" && entry.gender in GENDER_ZH
      ? entry.gender as GenderEstimate
      : "unknown";
    const action = typeof entry.action === "string" && entry.action in ACTION_ZH
      ? entry.action as PersonAction
      : "unknown";

    const detRaw = isRecord(entry.det) ? entry.det : {};
    const det: YoloDetection = {
      x: typeof detRaw.x === "number" ? detRaw.x : 0.08 + index * 0.04,
      y: typeof detRaw.y === "number" ? detRaw.y : 0.15 + index * 0.03,
      w: typeof detRaw.w === "number" ? detRaw.w : 0.16,
      h: typeof detRaw.h === "number" ? detRaw.h : 0.32,
      classId: typeof detRaw.classId === "number" ? detRaw.classId : COCO_ID.PERSON,
      score: typeof detRaw.score === "number" ? detRaw.score : 0.7,
      className: typeof detRaw.className === "string" ? detRaw.className : "person",
      classEn: typeof detRaw.classEn === "string" ? detRaw.classEn : "person",
    };

    return [{
      det,
      gender,
      genderConf: typeof entry.genderConf === "number" ? entry.genderConf : 0.35,
      genderBasis: typeof entry.genderBasis === "string" ? entry.genderBasis : "來源 payload",
      action,
      actionConf: typeof entry.actionConf === "number" ? entry.actionConf : 0.55,
      actionBasis: typeof entry.actionBasis === "string" ? entry.actionBasis : "來源 payload",
      trackId: typeof entry.trackId === "number" ? entry.trackId : index + 1,
    }];
  });
}

function detectFirstMatch(text: string, patterns: Record<string, RegExp>): string | null {
  return Object.entries(patterns).find(([, regex]) => regex.test(text))?.[0] ?? null;
}

function parsePersonCount(text: string, payload?: Record<string, unknown>) {
  const direct = payload?.person_count;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }

  const match = text.match(/(\d+)\s*(?:位)?\s*(?:人員|人|persons?|people)/i);
  if (match) {
    return Number(match[1]);
  }
  if (/人員|人像|person|people/i.test(text)) {
    return 1;
  }
  return 0;
}

function buildTextDerivedSnapshot(payload: Record<string, unknown>, text: string): PeopleAnalysisSnapshot {
  const normalized = text.toLowerCase();
  const personCount = parsePersonCount(text, payload);

  const genderPatterns: Record<GenderEstimate, RegExp> = {
    male: /(^|[^a-z])(male|man|男性|男子|男員工|男)([^a-z]|$)/i,
    female: /(^|[^a-z])(female|woman|女性|女子|女員工|女)([^a-z]|$)/i,
    unknown: /.^/,
  };
  const actionPatterns: Record<PersonAction, RegExp> = {
    raising_hand: /舉手|招手|raise(?:s|d)? hand|hand up/i,
    running: /奔跑|跑動|running|run\b/i,
    walking: /行走|走路|walking|walk\b/i,
    sitting: /坐著|坐姿|sitting|seated/i,
    squatting: /蹲下|蹲姿|squatting|squat\b/i,
    bending: /彎腰|俯身|bending|bent over/i,
    standing: /站立|站姿|standing/i,
    unknown: /.^/,
  };

  const genderMatch = detectFirstMatch(text, genderPatterns) as GenderEstimate | null;
  const actionMatch = detectFirstMatch(text, actionPatterns) as PersonAction | null;

  const personInfos: PersonInfo[] = Array.from({ length: personCount }, (_, index) => ({
    det: {
      x: 0.08 + index * 0.05,
      y: 0.14 + (index % 2) * 0.03,
      w: 0.18,
      h: 0.36,
      classId: COCO_ID.PERSON,
      score: 0.55,
      className: "person",
      classEn: "person",
    },
    gender: index === 0 && genderMatch ? genderMatch : "unknown",
    genderConf: index === 0 && genderMatch ? 0.35 : 0,
    genderBasis: index === 0 && genderMatch ? "從 VLM 文字結果擷取" : "未提供可用線索",
    action: index === 0 && actionMatch ? actionMatch : "unknown",
    actionConf: index === 0 && actionMatch ? 0.58 : 0,
    actionBasis: index === 0 && actionMatch ? "從 VLM 文字結果擷取" : "未提供可用線索",
    trackId: index + 1,
  }));

  const behaviors: BehaviorAlert[] = [];
  const keywords: Array<[BehaviorType, RegExp, number]> = [
    ["fall_detected", /跌倒|倒地|fall/i, 0.8],
    ["crowding", /聚集|crowd|擁擠/i, 0.72],
    ["ppe_violation", /未戴安全帽|未佩戴|ppe|違規穿戴|no helmet/i, 0.65],
    ["hazard_proximity", /危險物|hazard|刀具|尖銳物/i, 0.62],
    ["vehicle_proximity", /車輛|叉車|forklift|truck|vehicle/i, 0.66],
    ["phone_usage", /手機|phone/i, 0.58],
    ["loitering", /滯留|逗留|loiter/i, 0.6],
    ["abnormal_posture", /彎腰|姿勢異常|posture/i, 0.6],
    ["person_running", /奔跑|跑動|running|run\b/i, 0.7],
    ["person_raising_hand", /舉手|招手|raise(?:s|d)? hand|hand up/i, 0.72],
  ];

  for (const [type, regex, confidence] of keywords) {
    if (regex.test(normalized)) {
      behaviors.push(makeAlert(type, confidence, `從 VLM 結果偵測到關鍵字：${regex.source}`));
    }
  }

  if (personCount >= 2) {
    behaviors.push(makeAlert("multiple_persons", Math.min(0.85, 0.45 + personCount * 0.08), `同場偵測到 ${personCount} 位人員`));
  }
  if (personCount === 0) {
    return { personInfos: [], behaviors: [], personCount: 0, sourceText: text, sourceType: "empty" };
  }

  return {
    personInfos,
    behaviors,
    personCount,
    sourceText: text,
    sourceType: "text",
  };
}

export function extractPeopleAnalysisFromPayload(payload: unknown): PeopleAnalysisSnapshot {
  if (!isRecord(payload)) {
    return { personInfos: [], behaviors: [], personCount: 0, sourceType: "empty" };
  }

  const directPersonInfos = parseDirectPersonInfos(payload);
  if (directPersonInfos.length) {
    return {
      personInfos: directPersonInfos,
      behaviors: [],
      personCount: directPersonInfos.length,
      sourceType: "structured",
    };
  }

  const textSource = [
    typeof payload.anomaly_summary === "string" ? payload.anomaly_summary : "",
    typeof payload.findings_summary === "string" ? payload.findings_summary : "",
    typeof payload.raw_text === "string" ? payload.raw_text : "",
  ].find((value) => value.trim());

  if (textSource) {
    return buildTextDerivedSnapshot(payload, textSource);
  }

  return { personInfos: [], behaviors: [], personCount: 0, sourceType: "empty" };
}

export function useBehaviorDetector() {
  const [behaviors, setBehaviors] = useState<BehaviorAlert[]>([]);
  const [personInfos, setPersonInfos] = useState<PersonInfo[]>([]);
  const movementHistoryRef = useRef<Map<number, MovementRecord>>(new Map());

  const detect = useCallback((detections: YoloDetection[], poses: PoseDetection[], tracks: TrackedObject[]) => {
    const alerts: BehaviorAlert[] = [];
    const persons = detections.filter((item) => item.classId === COCO_ID.PERSON);
    const vehicleIds = new Set<number>([COCO_ID.BICYCLE, COCO_ID.CAR, COCO_ID.MOTORCYCLE, COCO_ID.BUS, COCO_ID.TRUCK]);
    const hazardIds = new Set<number>([COCO_ID.KNIFE, COCO_ID.SCISSORS, COCO_ID.BASEBALL_BAT]);
    const vehicles = detections.filter((item) => vehicleIds.has(item.classId));
    const hazards = detections.filter((item) => hazardIds.has(item.classId));
    const phones = detections.filter((item) => item.classId === COCO_ID.CELL_PHONE);

    const movementMap = movementHistoryRef.current;
    const activeTrackIds = new Set(tracks.map((track) => track.trackId));
    for (const trackId of Array.from(movementMap.keys())) {
      if (!activeTrackIds.has(trackId)) {
        movementMap.delete(trackId);
      }
    }

    for (const track of tracks) {
      const centerX = track.x + track.w / 2;
      const centerY = track.y + track.h / 2;
      const prev = movementMap.get(track.trackId);
      if (prev) {
        const distance = Math.sqrt((centerX - prev.centerX) ** 2 + (centerY - prev.centerY) ** 2);
        prev.velocity = distance;
        prev.centerX = centerX;
        prev.centerY = centerY;
        prev.frameCount = distance < LOITER_DIST_THRESH ? prev.frameCount + 1 : 0;
      } else {
        movementMap.set(track.trackId, { centerX, centerY, velocity: 0, frameCount: 1 });
      }
    }

    const nextPersonInfos = persons.map((person) => {
      const pose = matchPose(person, poses);
      const track = matchTrack(person, tracks);
      const velocity = track ? movementMap.get(track.trackId)?.velocity ?? 0 : 0;
      const gender = pose ? estimateGender(pose.keypoints) : { gender: "unknown" as GenderEstimate, conf: 0, basis: "無姿態資料" };
      const action = detectAction(pose, velocity);

      return {
        det: person,
        pose,
        trackId: track?.trackId,
        gender: gender.gender,
        genderConf: gender.conf,
        genderBasis: gender.basis,
        action: action.action,
        actionConf: action.conf,
        actionBasis: action.basis,
      };
    });

    setPersonInfos(nextPersonInfos);

    for (const info of nextPersonInfos) {
      if (info.action === "running") {
        alerts.push(makeAlert("person_running", info.actionConf, "依姿態與位移判定為奔跑", info.trackId ? [info.trackId] : undefined));
      }
      if (info.action === "raising_hand") {
        alerts.push(makeAlert("person_raising_hand", info.actionConf, "依姿態判定為舉手", info.trackId ? [info.trackId] : undefined));
      }
      if (info.action === "bending" || info.action === "squatting") {
        alerts.push(makeAlert("abnormal_posture", info.actionConf, `依姿態判定為${ACTION_ZH[info.action]}`, info.trackId ? [info.trackId] : undefined));
      }
    }

    if (persons.length >= 2) {
      alerts.push(makeAlert("multiple_persons", Math.min(0.9, 0.45 + persons.length * 0.1), `同場偵測到 ${persons.length} 位人員`, tracks.map((track) => track.trackId)));
    }
    if (persons.length >= 3) {
      alerts.push(makeAlert("crowding", Math.min(1, persons.length / 5), `偵測到 ${persons.length} 位人員聚集`, tracks.map((track) => track.trackId)));
    }
    if (persons.length > 0) {
      alerts.push(makeAlert("ppe_violation", 0.4, "目前僅能提示需要 VLM 二次確認 PPE 狀態", tracks.filter((track) => track.classId === COCO_ID.PERSON).map((track) => track.trackId)));
    }

    if (persons.length > 0 && hazards.length > 0) {
      let minDistance = Infinity;
      let hazardName = "";
      for (const person of persons) {
        for (const hazard of hazards) {
          const distance = centerDist(person, hazard);
          if (distance < minDistance) {
            minDistance = distance;
            hazardName = hazard.classEn;
          }
        }
      }
      if (minDistance < HAZARD_FAR_THRESH) {
        alerts.push(makeAlert("hazard_proximity", minDistance < HAZARD_CLOSE_THRESH ? 0.9 : 0.7, `人員與危險物品（${hazardName}）距離過近`));
      }
    }

    if (persons.length > 0 && vehicles.length > 0) {
      let minDistance = Infinity;
      let vehicleName = "";
      for (const person of persons) {
        for (const vehicle of vehicles) {
          const distance = centerDist(person, vehicle);
          if (distance < minDistance) {
            minDistance = distance;
            vehicleName = vehicle.classEn;
          }
        }
      }
      alerts.push(makeAlert("vehicle_proximity", Math.min(0.95, Math.max(0.5, 1 - minDistance)), `偵測到人員與車輛（${vehicleName}）同場`));
    }

    if (persons.length > 0 && phones.length > 0) {
      alerts.push(makeAlert("phone_usage", 0.55, `同場偵測到 ${phones.length} 個疑似手機物件`));
    }

    for (const [trackId, movement] of movementMap.entries()) {
      if (movement.frameCount >= LOITER_FRAME_THRESH) {
        alerts.push(makeAlert("loitering", 0.65, `追蹤 ID #${trackId} 長時間停留`, [trackId]));
      }
    }

    setBehaviors(alerts);
    return alerts;
  }, []);

  const reset = useCallback(() => {
    movementHistoryRef.current.clear();
    setBehaviors([]);
    setPersonInfos([]);
  }, []);

  return {
    behaviors,
    personInfos,
    detect,
    reset,
  };
}
