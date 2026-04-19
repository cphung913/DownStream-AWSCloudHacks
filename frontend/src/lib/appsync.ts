/**
 * AppSync client shim.
 *
 * In production this holds the Amplify DataStore / AppSync subscription setup
 * for the `onTickUpdate` WebSocket and the `startSimulation` / `placeBarrier`
 * mutations. Kept as a stub so the frontend can run without AWS credentials
 * during local development -- see useSimulationDriver for the mock fallback.
 */
import type { IncidentReportJson, SegmentState, TownRisk } from "@/types/simulation";

export interface TickPayload {
  simulationId: string;
  tick: number;
  segmentUpdates: ReadonlyArray<[string, SegmentState]>;
  towns: ReadonlyArray<TownRisk>;
}

export interface StartSimulationResult {
  simulationId: string;
}

export interface AppSyncClient {
  startSimulation: (input: unknown) => Promise<StartSimulationResult>;
  subscribeToTicks: (
    simulationId: string,
    onTick: (tick: TickPayload) => void,
    onReport: (report: IncidentReportJson) => void,
    onError: (err: Error) => void,
  ) => () => void;
}

export const appsyncEndpoint = import.meta.env.VITE_APPSYNC_URL as string | undefined;

export function createAppSyncClient(): AppSyncClient | null {
  if (!appsyncEndpoint) return null;
  // Real subscription client not yet implemented — falls back to mock driver.
  return null;
}
