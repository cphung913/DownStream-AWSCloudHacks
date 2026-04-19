import { useEffect } from "react";
import { useSimulationStore } from "@/stores/simulation";
import { useAlertStore } from "@/stores/alert";
import type { RiskLevel, SegmentState, TownRisk } from "@/types/simulation";
import { TICK_RESOLUTION_MINUTES } from "@/types/simulation";
import { createAppSyncClient } from "@/lib/appsync";
import { generateSyntheticRiver, mockConcentrationAt } from "@/lib/syntheticRiver";

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
  const applyTickUpdate = useSimulationStore((s) => s.applyTickUpdate);
  const completeSimulation = useSimulationStore((s) => s.completeSimulation);
  const pushAlert = useAlertStore((s) => s.push);

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

    // Walk the plume the full length of the river, plus slack for the peak
    // to pass the last town. Ticks-per-advection-step is baked into
    // mockConcentrationAt; we just need enough ticks to cover `maxDistance`.
    const totalTicks = Math.max(24, Math.ceil(river.maxDistance / 2.4) + 10);
    const tickIntervalMs = Math.max(
      120,
      1000 * (TICK_RESOLUTION_MINUTES[config.tickResolution] / 60) * 0.5,
    );
    let tick = 0;

    const timer = window.setInterval(() => {
      tick += 1;

      const segmentUpdates: [string, SegmentState][] = [];
      for (const seg of river.segments) {
        if (seg.distanceFromSource >= UNREACHED_THRESHOLD) continue;
        const concentration = mockConcentrationAt(seg.distanceFromSource, tick);
        segmentUpdates.push([
          seg.segmentId,
          { concentration, riskLevel: classify(concentration) },
        ]);
      }

      const towns: TownRisk[] = river.towns.map((rt) => {
        const concentration = mockConcentrationAt(rt.distanceFromSource, tick);
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
        const affectedTowns = river.towns.filter((rt) =>
          mockConcentrationAt(rt.distanceFromSource, totalTicks) > 0.15,
        );
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
