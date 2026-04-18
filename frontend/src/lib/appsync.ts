import { generateClient } from "aws-amplify/api";
import type { GraphQLSubscription } from "@aws-amplify/api-graphql";
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
  const sub = (
    client.graphql({
      query: ON_TICK_UPDATE,
      variables: { simulationId },
    }) as unknown as GraphQLSubscription<{ onTickUpdate: TickUpdate }>
  ).subscribe({
    next: ({ data }) => {
      if (data?.onTickUpdate) onNext(data.onTickUpdate);
    },
    error: (err) => onError(err),
  });
  return { unsubscribe: () => sub.unsubscribe() };
}
