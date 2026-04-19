import { generateClient } from "aws-amplify/api";
import {
  ON_TICK_UPDATE,
  START_SIMULATION,
  GET_TICK_SNAPSHOT,
  APPLY_MITIGATION,
} from "./graphql";
import type {
  TickUpdate,
  StartSimulationInput,
  StartSimulationResult,
  MitigationInput,
} from "./graphql";
import type { IncidentReportJson } from "@/types/simulation";

const client = generateClient();

export async function startSimulation(
  input: StartSimulationInput,
): Promise<StartSimulationResult> {
  const res = await client.graphql({
    query: START_SIMULATION,
    variables: { input },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res as any).data.startSimulation as StartSimulationResult;
}

export async function getTickSnapshot(
  simulationId: string,
  tick: number,
): Promise<TickUpdate | null> {
  const res = await client.graphql({
    query: GET_TICK_SNAPSHOT,
    variables: { simulationId, tick },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res as any).data.getTickSnapshot ?? null;
}

export async function applyMitigation(
  simulationId: string,
  mitigation: MitigationInput,
): Promise<unknown> {
  const res = await client.graphql({
    query: APPLY_MITIGATION,
    variables: { simulationId, mitigation },
  });
  return res;
}

export function subscribeToTicks(
  simulationId: string,
  onNext: (u: TickUpdate) => void,
  onError: (e: unknown) => void,
): { unsubscribe: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observable = client.graphql({
    query: ON_TICK_UPDATE,
    variables: { simulationId },
  }) as unknown as { subscribe: (opts: { next: (v: any) => void; error: (e: unknown) => void }) => { unsubscribe: () => void } };

  const sub = observable.subscribe({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    next: (response: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const update = response?.data?.onTickUpdate as TickUpdate | undefined;
      if (update) onNext(update);
    },
    error: (err: unknown) => onError(err),
  });
  return { unsubscribe: () => sub.unsubscribe() };
}

export interface AppSyncClient {
  subscribeToTicks: (
    simulationId: string,
    onTick: (t: TickUpdate) => void,
    onComplete: (report: IncidentReportJson) => void,
    onError: () => void,
  ) => () => void;
}

export function createAppSyncClient(): AppSyncClient | null {
  const endpoint = import.meta.env.VITE_APPSYNC_URL as string | undefined;
  if (!endpoint) return null;

  return {
    subscribeToTicks(simulationId, onTick, onComplete, onError) {
      const sub = subscribeToTicks(
        simulationId,
        onTick,
        onError,
      );
      void onComplete;
      return () => sub.unsubscribe();
    },
  };
}
