import {
  ACTION_ZH as INTERNAL_ACTION_ZH,
  GENDER_ZH as INTERNAL_GENDER_ZH,
  extractPeopleAnalysisFromPayload,
} from "@/hooks/useBehaviorDetector";
import type {
  PeopleAnalysisAdapter,
  PeopleAnalysisInput,
  PeopleAnalysisOutput,
  PersonAction,
  GenderEstimate,
} from "@/types/vlm-porting";

export const PEOPLE_ANALYSIS_STORAGE_KEY = "xcloud.live_vlm.latest_result";
export const PEOPLE_ANALYSIS_MODE_LABEL = "Preview / Heuristic";

export const PEOPLE_ACTION_LABELS: Record<PersonAction, string> = {
  standing: INTERNAL_ACTION_ZH.standing,
  sitting: INTERNAL_ACTION_ZH.sitting,
  walking: INTERNAL_ACTION_ZH.walking,
  running: INTERNAL_ACTION_ZH.running,
  raising_hand: INTERNAL_ACTION_ZH.raising_hand,
  bending: INTERNAL_ACTION_ZH.bending,
  squatting: INTERNAL_ACTION_ZH.squatting,
  unknown: INTERNAL_ACTION_ZH.unknown,
};

export const PEOPLE_GENDER_LABELS: Record<GenderEstimate, string> = {
  male: INTERNAL_GENDER_ZH.male,
  female: INTERNAL_GENDER_ZH.female,
  unknown: INTERNAL_GENDER_ZH.unknown,
};

export const peopleAnalysisAdapter: PeopleAnalysisAdapter = {
  parse(input: PeopleAnalysisInput): PeopleAnalysisOutput {
    const parsed = extractPeopleAnalysisFromPayload(input.rawPayload);
    return {
      source: parsed.sourceType,
      personCount: parsed.personCount,
      personInfos: parsed.personInfos.map((item) => ({
        gender: item.gender,
        action: item.action,
        genderConf: item.genderConf,
        actionConf: item.actionConf,
        genderBasis: item.genderBasis,
        actionBasis: item.actionBasis,
      })),
      behaviors: parsed.behaviors.map((item) => ({
        type: item.type,
        risk: item.risk,
        confidence: item.confidence,
        timestamp: item.timestamp,
        nameZh: item.nameZh,
        nameEn: item.nameEn,
        description: item.description,
      })),
      sourceText: parsed.sourceText,
    };
  },
};
