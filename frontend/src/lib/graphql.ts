// Hand-authored GraphQL operations mirroring backend/graphql/schema.graphql.
// Regenerate via @aws-amplify codegen once the endpoint exists.

import type { RiskLevel, SegmentState } from "../types/simulation";

export type Basin = "MISSISSIPPI" | "OHIO" | "COLORADO";
export type SpillType =
  | "INDUSTRIAL_SOLVENT"
  | "AGRICULTURAL_RUNOFF"
  | "OIL_PETROLEUM"
  | "HEAVY_METALS";

export interface MitigationInput {
  kind: string;
  segmentId: string;
  costUsd: number;
  radiusMeters?: number | null;
}

export interface StartSimulationInput {
  basin: Basin;
  sourceSegmentId: string;
  spillType: SpillType;
  volumeGallons: number;
  temperatureCelsius: number;
  responseDelayHours: number;
  mitigations: MitigationInput[];
  budgetUsd: number;
  tickResolutionMinutes: number;
  totalTicks: number;
}

export interface StartSimulationResult {
  simulationId: string;
  executionArn: string;
}

export interface SegmentUpdate {
  segmentId: string;
  concentration: number;
  riskLevel: RiskLevel;
}

export interface TownRiskUpdate {
  townId: string;
  name: string;
  population: number;
  segmentId: string;
  riskLevel: RiskLevel;
  tickCrossed: number | null;
}

export interface TickUpdate {
  simulationId: string;
  tick: number;
  segmentUpdates: ReadonlyArray<[string, SegmentState]>;
  towns: ReadonlyArray<TownRiskUpdate>;
}

export type { RiskLevel, SegmentState };

export const START_SIMULATION = /* GraphQL */ `
  mutation StartSimulation($input: StartSimulationInput!) {
    startSimulation(input: $input) {
      simulationId
      executionArn
    }
  }
`;

export const APPLY_MITIGATION = /* GraphQL */ `
  mutation ApplyMitigation($simulationId: ID!, $mitigation: MitigationInput!) {
    applyMitigation(simulationId: $simulationId, mitigation: $mitigation) {
      simulationId
      currentTick
    }
  }
`;

export const ON_TICK_UPDATE = /* GraphQL */ `
  subscription OnTickUpdate($simulationId: ID!) {
    onTickUpdate(simulationId: $simulationId) {
      simulationId
      tick
      segmentUpdates {
        segmentId
        concentration
        riskLevel
      }
    }
  }
`;

export const GET_TICK_SNAPSHOT = /* GraphQL */ `
  query GetTickSnapshot($simulationId: ID!, $tick: Int!) {
    getTickSnapshot(simulationId: $simulationId, tick: $tick) {
      simulationId
      tick
      segmentUpdates {
        segmentId
        concentration
        riskLevel
      }
    }
  }
`;

export const GET_ICS208_URL = /* GraphQL */ `
  query GetIcs208Url($simulationId: ID!) {
    getIcs208Url(simulationId: $simulationId) {
      url
      error
    }
  }
`;
