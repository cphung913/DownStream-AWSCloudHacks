import { useEffect, useRef } from "react";
import { useSimulationStore } from "@/stores/simulation";
import { useAlertStore } from "@/stores/alert";
import type { LngLat, RiskLevel, SegmentState, SpillType, TownRisk } from "@/types/simulation";
import { MITIGATION_EFFECTIVENESS, TICK_RESOLUTION_MINUTES } from "@/types/simulation";
import type { MitigationKind } from "@/types/simulation";
import { createAppSyncClient } from "@/lib/appsync";
import {
  generateSyntheticRiver,
  mockConcentrationAt,
  PLUME_SPEED,
  type SyntheticSegment,
} from "@/lib/syntheticRiver";

/**
 * Connects the simulation store to tick sources.
 *
 *   - If VITE_APPSYNC_URL is set, subscribes to AppSync onTickUpdate.
 *   - Otherwise drives a deterministic client-side mock so the UI is
 *     functional before AWS is provisioned. The mock walks the same
 *     synthetic river that `useRiverGraph` paints, so segment ids line up
 *     and the map actually lights up as the plume advances.
 */
export function useSimulationDriver() {
  const status = useSimulationStore((s) => s.status);
  const simulationId = useSimulationStore((s) => s.simulationId);
  const config = useSimulationStore((s) => s.config);
  const barriers = useSimulationStore((s) => s.barriers);
  const applyTickUpdate = useSimulationStore((s) => s.applyTickUpdate);
  const completeSimulation = useSimulationStore((s) => s.completeSimulation);
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const pushAlert = useAlertStore((s) => s.push);
  const clearAlerts = useAlertStore((s) => s.clear);

  // Clear stale alerts whenever a new run starts.
  useEffect(() => {
    if (status === "running") clearAlerts();
  }, [status, clearAlerts]);

  // When barriers change on a completed simulation, auto-rerun so the
  // counterfactual propagates through the tick loop and updates the cost report.
  const prevBarrierCount = useRef(barriers.length);
  useEffect(() => {
    if (status !== "completed") {
      prevBarrierCount.current = barriers.length;
      return;
    }
    if (barriers.length !== prevBarrierCount.current) {
      prevBarrierCount.current = barriers.length;
      startSimulation();
    }
  }, [barriers.length, status, startSimulation]);

  useEffect(() => {
    if (status !== "running" || !simulationId) return;

    const appsync = createAppSyncClient();
    if (appsync) {
      return appsync.subscribeToTicks(
        simulationId,
        (t) => applyTickUpdate(t.tick, t.segmentUpdates as ReadonlyArray<[string, import("@/types/simulation").SegmentState]>, t.towns),
        (report) => completeSimulation(report),
        () => {
          /* surfaced via status */
        },
      );
    }

    // --- mock driver (used when VITE_APPSYNC_URL is unset or client not implemented) ---
    if (!config.sourceLngLat) return;

    const river = generateSyntheticRiver(config.sourceLngLat, config.region);
    const priorRisk = new Map<string, RiskLevel>();
    const firstCrossTick = new Map<string, number>();
    // Segments far enough beyond the plume that mockConcentrationAt will always
    // return 0 for them (tributaries + upstream-of-source main stem). Skipping
    // them saves ~35 no-op map writes per tick.
    const UNREACHED_THRESHOLD = 10_000;

    // Build a lookup from segmentId → distanceFromSource so barriers (which
    // carry a segmentId) can be mapped back to a river distance.
    const segDistMap = new Map(river.segments.map((s) => [s.segmentId, s.distanceFromSource]));

    // Walk the plume the full length of the river, plus slack for the peak
    // to pass the last town. Ticks-per-advection-step is baked into
    // mockConcentrationAt; we just need enough ticks to cover `maxDistance`.
    const totalTicks = Math.max(24, Math.ceil(river.maxDistance / PLUME_SPEED) + 10);
    const tickIntervalMs = Math.max(
      120,
      1000 * (TICK_RESOLUTION_MINUTES[config.tickResolution] / 60) * 0.5,
    );
    let tick = 0;

    const timer = window.setInterval(() => {
      tick += 1;

      // Read barriers live via getState() so mid-run placements take effect
      // on the very next tick without restarting the interval.
      const { barriers, config: liveConfig } = useSimulationStore.getState();
      const spillType = liveConfig.spillType;

      // Resolve each barrier to a synthetic-river distance using lngLat
      // proximity. Segment ID lookup is unreliable — when the real basin
      // GeoJSON is loaded the map returns NHD ComIDs, but the synthetic
      // driver uses seg-N IDs. Snapping by coordinate works regardless.
      const activeBarriers = barriers
        .filter((b) => b.placedAtTick < tick)
        .map((b) => ({
          distance: nearestMainStemDistance(river.segments, b.lngLat, segDistMap),
          kind: b.kind,
        }))
        .filter((b) => b.distance < UNREACHED_THRESHOLD);

      const segmentUpdates: [string, SegmentState][] = [];
      for (const seg of river.segments) {
        if (seg.distanceFromSource >= UNREACHED_THRESHOLD) continue;
        const mult = barrierMultiplier(seg.distanceFromSource, activeBarriers, spillType);
        const concentration = mockConcentrationAt(seg.distanceFromSource, tick, PLUME_SPEED, mult);
        segmentUpdates.push([
          seg.segmentId,
          { concentration, riskLevel: classify(concentration) },
        ]);
      }

      const towns: TownRisk[] = river.towns.map((rt) => {
        const mult = barrierMultiplier(rt.distanceFromSource, activeBarriers, spillType);
        const concentration = mockConcentrationAt(rt.distanceFromSource, tick, PLUME_SPEED, mult);
        const riskLevel = classify(concentration);
        if (concentration > 0 && !firstCrossTick.has(rt.townId)) {
          firstCrossTick.set(rt.townId, tick);
        }
        return {
          townId: rt.townId,
          name: rt.name,
          population: rt.population,
          segmentId: rt.segmentId,
          lngLat: rt.lngLat,
          riskLevel,
          tickCrossed: firstCrossTick.get(rt.townId) ?? null,
        };
      });

      for (const t of towns) {
        const prior = priorRisk.get(t.townId) ?? "CLEAR";
        if (escalated(prior, t.riskLevel)) {
          pushAlert({
            tick,
            townId: t.townId,
            townName: t.name,
            population: t.population,
            riskLevel: t.riskLevel,
            note: `Crossed ${t.riskLevel} threshold at tick ${tick}`,
          });
        }
        priorRisk.set(t.townId, t.riskLevel);
      }

      applyTickUpdate(tick, segmentUpdates, towns);

      if (tick >= totalTicks) {
        window.clearInterval(timer);
        const { barriers: finalBarriers, config: finalConfig } = useSimulationStore.getState();
        const finalActiveBarriers = finalBarriers
          .filter((b) => b.placedAtTick < totalTicks)
          .map((b) => ({ distance: nearestMainStemDistance(river.segments, b.lngLat, segDistMap), kind: b.kind }))
          .filter((b) => b.distance < UNREACHED_THRESHOLD);
        const affectedTowns = river.towns.filter((rt) => {
          const mult = barrierMultiplier(rt.distanceFromSource, finalActiveBarriers, finalConfig.spillType);
          return mockConcentrationAt(rt.distanceFromSource, totalTicks, PLUME_SPEED, mult) > 0.15;
        });
        const populationAtRisk = affectedTowns.reduce((sum, rt) => sum + rt.population, 0);
        completeSimulation({
          executiveSummary:
            `${formatGallons(config.volumeGallons)} of ${config.spillType
              .replace(/_/g, " ")
              .toLowerCase()} released into the ${config.region} basin. With a ${
              config.responseDelayHours
            }h response delay, plume advected through ${affectedTowns.length} downstream municipalities before containment. Recommend immediate EPA Regional Response Team notification and downstream water utility isolation.`,
          populationAtRisk,
          estimatedCleanupCost: Math.round(config.volumeGallons * 180 + populationAtRisk * 12),
          regulatoryObligations: [
            "EPA 40 CFR Part 300 — National Contingency Plan activation within 1h",
            "CWA Section 311 — notify National Response Center (1-800-424-8802)",
            "40 CFR 355 — EPCRA Emergency Release Notification to SERC/LEPC within 15min",
          ],
          mitigationPriorityList: [
            "Deploy containment booms at tributary confluences downstream of source",
            "Isolate downstream drinking-water intakes (Memphis MLGW, EBRPSS)",
            "Stage bioremediation agent at estimated plume front",
            "Coordinate evacuation advisory through state EMA channels",
          ],
        });
      }
    }, tickIntervalMs);

    return () => window.clearInterval(timer);
  }, [status, simulationId, config, applyTickUpdate, completeSimulation, pushAlert]);
}

function classify(concentration: number): RiskLevel {
  if (concentration >= 0.75) return "DANGER";
  if (concentration >= 0.45) return "ADVISORY";
  if (concentration >= 0.15) return "MONITOR";
  return "CLEAR";
}

const RISK_ORDER: Record<RiskLevel, number> = {
  CLEAR: 0,
  MONITOR: 1,
  ADVISORY: 2,
  DANGER: 3,
};

function escalated(prior: RiskLevel, next: RiskLevel): boolean {
  return RISK_ORDER[next] > RISK_ORDER[prior];
}

function formatGallons(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M gallons`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K gallons`;
  return `${n} gallons`;
}

/**
 * Find the distanceFromSource of the nearest reachable main-stem segment to
 * `lngLat`. Falls back to an exact segDistMap lookup first so synthetic
 * seg-N IDs still resolve instantly; proximity search covers the case where
 * the map returned a real NHD ComID (or any ID not in segDistMap).
 */
function nearestMainStemDistance(
  segments: ReadonlyArray<SyntheticSegment>,
  lngLat: LngLat,
  segDistMap: ReadonlyMap<string, number>,
): number {
  // Fast path: exact ID match (only works for synthetic seg-N clicks)
  // We don't have the segmentId here — proximity is always correct.
  const UNREACHED_THRESHOLD = 10_000;
  let bestDistSq = Infinity;
  let bestRiverDist = Infinity;
  for (const seg of segments) {
    if (!seg.isMainStem || seg.distanceFromSource >= UNREACHED_THRESHOLD) continue;
    const midLng = (seg.start[0] + seg.end[0]) / 2;
    const midLat = (seg.start[1] + seg.end[1]) / 2;
    const dLng = midLng - lngLat[0];
    const dLat = midLat - lngLat[1];
    const dSq = dLng * dLng + dLat * dLat;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestRiverDist = seg.distanceFromSource;
    }
  }
  // Suppress unused-var warning — segDistMap kept for future exact-ID fast path
  void segDistMap;
  return bestRiverDist;
}

/**
 * Product of MITIGATION_EFFECTIVENESS pass-through fractions for all active
 * barriers that sit upstream of `segmentDistance`. Multiple barriers compound
 * multiplicatively (each reduces what the next one sees).
 */
function barrierMultiplier(
  segmentDistance: number,
  activeBarriers: ReadonlyArray<{ distance: number; kind: MitigationKind }>,
  spillType: SpillType,
): number {
  let mult = 1.0;
  for (const b of activeBarriers) {
    if (b.distance >= segmentDistance) continue; // barrier at or downstream — no upstream effect
    mult *= MITIGATION_EFFECTIVENESS[b.kind][spillType];
  }
  return mult;
}
