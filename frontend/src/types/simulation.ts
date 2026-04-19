export type SpillType =
  | "INDUSTRIAL_SOLVENT"
  | "AGRICULTURAL_RUNOFF"
  | "OIL_PETROLEUM"
  | "HEAVY_METALS";

export type Region = "mississippi" | "ohio" | "colorado";

export type RiskLevel = "CLEAR" | "MONITOR" | "ADVISORY" | "DANGER";

export type SimulationStatus =
  | "idle"
  | "loading"
  | "running"
  | "completed"
  | "error";

export type TickResolution = "FIFTEEN_MIN" | "ONE_HOUR" | "SIX_HOURS";

export type MitigationKind =
  | "CONTAINMENT_BARRIER"
  | "BOOM_DEPLOYMENT"
  | "BIOREMEDIATION"
  | "EMERGENCY_DIVERSION";

export type LngLat = [number, number];

export interface SimulationConfig {
  region: Region;
  sourceSegmentId: string | null;
  sourceLngLat: LngLat | null;
  spillType: SpillType;
  volumeGallons: number;
  temperatureC: number;
  responseDelayHours: number;
  budgetCapUsd: number;
  tickResolution: TickResolution;
}

export interface Barrier {
  id: string;
  kind: MitigationKind;
  segmentId: string;
  lngLat: LngLat;
  radiusMeters: number;
  costUsd: number;
  placedAtTick: number;
}

export interface SegmentState {
  concentration: number;
  riskLevel: RiskLevel;
}

export interface TownRisk {
  townId: string;
  name: string;
  population: number;
  segmentId: string;
  /** Present in synthetic/demo mode; production towns are joined on segment geometry. */
  lngLat?: LngLat;
  riskLevel: RiskLevel;
  tickCrossed: number | null;
}

export interface IncidentReportJson {
  executiveSummary: string;
  populationAtRisk: number;
  estimatedCleanupCost: number;
  regulatoryObligations: string[];
  mitigationPriorityList: string[];
}

export const SPILL_TYPE_LABEL: Record<SpillType, string> = {
  INDUSTRIAL_SOLVENT: "Industrial solvent",
  AGRICULTURAL_RUNOFF: "Agricultural runoff",
  OIL_PETROLEUM: "Oil / petroleum",
  HEAVY_METALS: "Heavy metals",
};

export const REGION_LABEL: Record<Region, string> = {
  mississippi: "Mississippi Basin",
  ohio: "Ohio Basin",
  colorado: "Colorado Basin",
};

export const MITIGATION_LABEL: Record<MitigationKind, string> = {
  CONTAINMENT_BARRIER: "Containment barrier",
  BOOM_DEPLOYMENT: "Boom deployment",
  BIOREMEDIATION: "Bioremediation agent",
  EMERGENCY_DIVERSION: "Emergency diversion",
};

export const MITIGATION_COST: Record<MitigationKind, number> = {
  CONTAINMENT_BARRIER: 75_000,
  BOOM_DEPLOYMENT: 40_000,
  BIOREMEDIATION: 120_000,
  EMERGENCY_DIVERSION: 250_000,
};

export const TICK_RESOLUTION_MINUTES: Record<TickResolution, number> = {
  FIFTEEN_MIN: 15,
  ONE_HOUR: 60,
  SIX_HOURS: 360,
};
