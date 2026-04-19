import { create } from "zustand";
import type {
  Barrier,
  IncidentReportJson,
  LngLat,
  MitigationKind,
  Region,
  SegmentState,
  SimulationConfig,
  SimulationStatus,
  SpillType,
  TickResolution,
  TownRisk,
} from "@/types/simulation";
import { MITIGATION_COST } from "@/types/simulation";

/**
 * Simulation store — single source of truth for map state.
 *
 * Components are pure renderers of this store. Do not hold simulation
 * state inside map or panel components. The time slider reads ticks
 * directly from DynamoDB in production; in dev we keep a ring buffer
 * of recent tick snapshots on the store for scrubbing.
 */

const DEFAULT_CONFIG: SimulationConfig = {
  region: "mississippi",
  sourceSegmentId: null,
  sourceLngLat: null,
  spillType: "INDUSTRIAL_SOLVENT",
  volumeGallons: 10_000,
  temperatureC: 18,
  responseDelayHours: 24,
  // Default bumped from $1M to $3M so a full-mitigation run ($2.2M at the
  // HMGP-anchored prices) stays feasible. Real Mississippi spill responses
  // typically run $10-15M; slider max in ControlPanel is sized accordingly.
  budgetCapUsd: 3_000_000,
  tickResolution: "ONE_HOUR",
};

interface TickSnapshot {
  tick: number;
  segments: ReadonlyMap<string, SegmentState>;
  towns: ReadonlyMap<string, TownRisk>;
}

interface SimulationState {
  simulationId: string | null;
  status: SimulationStatus;
  errorMessage: string | null;

  config: SimulationConfig;

  tick: number;
  totalTicks: number;

  segmentMap: ReadonlyMap<string, SegmentState>;
  townRiskMap: ReadonlyMap<string, TownRisk>;
  snapshots: TickSnapshot[];

  barriers: Barrier[];
  report: IncidentReportJson | null;

  // config setters
  setRegion: (r: Region) => void;
  setSource: (segmentId: string | null, lngLat: LngLat | null) => void;
  setSpillType: (t: SpillType) => void;
  setVolumeGallons: (v: number) => void;
  setTemperatureC: (v: number) => void;
  setResponseDelayHours: (v: number) => void;
  setBudgetCapUsd: (v: number) => void;
  setTickResolution: (r: TickResolution) => void;

  // lifecycle
  startSimulation: () => void;
  applyTickUpdate: (tick: number, updates: ReadonlyArray<[string, SegmentState]>, towns: ReadonlyArray<TownRisk>) => void;
  completeSimulation: (report: IncidentReportJson) => void;
  failSimulation: (message: string) => void;
  resetSimulation: () => void;

  // time scrubbing (reads historical snapshot from ring buffer)
  setTick: (tick: number) => void;

  // mitigation
  placeBarrier: (
    kind: MitigationKind,
    segmentId: string,
    lngLat: LngLat,
    radiusMeters: number,
  ) => { ok: true } | { ok: false; reason: string };
  removeBarrier: (barrierId: string) => void;

  // derived helpers
  totalMitigationCost: () => number;
  remainingBudget: () => number;
  canAfford: (kind: MitigationKind) => boolean;
}

const SNAPSHOT_WINDOW = 256;

export const useSimulationStore = create<SimulationState>((set, get) => ({
  simulationId: null,
  status: "idle",
  errorMessage: null,
  config: DEFAULT_CONFIG,
  tick: 0,
  totalTicks: 0,
  segmentMap: new Map(),
  townRiskMap: new Map(),
  snapshots: [],
  barriers: [],
  report: null,

  setRegion: (region) =>
    set((s) => ({ config: { ...s.config, region, sourceSegmentId: null, sourceLngLat: null } })),
  setSource: (segmentId, lngLat) =>
    set((s) => ({ config: { ...s.config, sourceSegmentId: segmentId, sourceLngLat: lngLat } })),
  setSpillType: (spillType) => set((s) => ({ config: { ...s.config, spillType } })),
  setVolumeGallons: (volumeGallons) => set((s) => ({ config: { ...s.config, volumeGallons } })),
  setTemperatureC: (temperatureC) => set((s) => ({ config: { ...s.config, temperatureC } })),
  setResponseDelayHours: (responseDelayHours) =>
    set((s) => ({ config: { ...s.config, responseDelayHours } })),
  setBudgetCapUsd: (budgetCapUsd) => set((s) => ({ config: { ...s.config, budgetCapUsd } })),
  setTickResolution: (tickResolution) => set((s) => ({ config: { ...s.config, tickResolution } })),

  startSimulation: () =>
    set((s) => ({
      simulationId: `sim-${crypto.randomUUID()}`,
      status: "running",
      errorMessage: null,
      tick: 0,
      totalTicks: 0,
      segmentMap: new Map(),
      townRiskMap: new Map(),
      snapshots: [],
      report: null,
      // Reset all barrier placedAtTick to 0 so they're active from tick 1
      // of the new run regardless of when they were originally placed.
      barriers: s.barriers.map((b) => ({ ...b, placedAtTick: 0 })),
    })),

  applyTickUpdate: (tick, updates, towns) =>
    set((s) => {
      const segmentMap = new Map(s.segmentMap);
      for (const [segmentId, state] of updates) segmentMap.set(segmentId, state);
      const townRiskMap = new Map(s.townRiskMap);
      for (const t of towns) townRiskMap.set(t.townId, t);
      const snapshot: TickSnapshot = { tick, segments: segmentMap, towns: townRiskMap };
      const snapshots = [...s.snapshots, snapshot].slice(-SNAPSHOT_WINDOW);
      return {
        tick,
        totalTicks: Math.max(s.totalTicks, tick),
        segmentMap,
        townRiskMap,
        snapshots,
      };
    }),

  completeSimulation: (report) => set({ status: "completed", report }),
  failSimulation: (errorMessage) => set({ status: "error", errorMessage }),

  resetSimulation: () =>
    set({
      simulationId: null,
      status: "idle",
      errorMessage: null,
      tick: 0,
      totalTicks: 0,
      segmentMap: new Map(),
      townRiskMap: new Map(),
      snapshots: [],
      barriers: [],
      report: null,
    }),

  setTick: (tick) =>
    set((s) => {
      const snapshot = s.snapshots.find((snap) => snap.tick === tick);
      if (!snapshot) return { tick };
      return { tick, segmentMap: snapshot.segments, townRiskMap: snapshot.towns };
    }),

  placeBarrier: (kind, segmentId, lngLat, radiusMeters) => {
    const s = get();
    const cost = MITIGATION_COST[kind];
    if (s.totalMitigationCost() + cost > s.config.budgetCapUsd) {
      return { ok: false, reason: "budget cap exceeded" };
    }
    const barrier: Barrier = {
      id: `b-${crypto.randomUUID()}`,
      kind,
      segmentId,
      lngLat,
      radiusMeters,
      costUsd: cost,
      placedAtTick: s.tick,
    };
    set({ barriers: [...s.barriers, barrier] });
    return { ok: true };
  },

  removeBarrier: (barrierId) =>
    set((s) => ({ barriers: s.barriers.filter((b) => b.id !== barrierId) })),

  totalMitigationCost: () => get().barriers.reduce((sum, b) => sum + b.costUsd, 0),
  remainingBudget: () => get().config.budgetCapUsd - get().totalMitigationCost(),
  canAfford: (kind) => get().remainingBudget() >= MITIGATION_COST[kind],
}));
