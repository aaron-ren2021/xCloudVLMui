export type PeopleSourceKind = "structured" | "text" | "empty";

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

export type BehaviorRisk = "critical" | "warning" | "safe" | "info";

export interface AdapterPersonInfo {
  gender: GenderEstimate;
  action: PersonAction;
  genderConf: number;
  actionConf: number;
  genderBasis?: string;
  actionBasis?: string;
}

export interface AdapterBehaviorInfo {
  type: string;
  risk: BehaviorRisk;
  confidence: number;
}

export interface PeopleAnalysisInput {
  rawPayload: unknown;
  capturedAt: string;
}

export interface PeopleAnalysisOutput {
  source: PeopleSourceKind;
  personCount: number;
  personInfos: AdapterPersonInfo[];
  behaviors: AdapterBehaviorInfo[];
}

export interface PeopleAnalysisAdapter {
  parse(input: PeopleAnalysisInput): PeopleAnalysisOutput;
}
