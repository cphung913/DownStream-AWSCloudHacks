import { useEffect } from "react";
import { useSimulationStore } from "@/stores/simulation";
import { useAlertStore } from "@/stores/alert";
import type { RiskLevel, SegmentState, TownRisk } from "@/types/simulation";
import { TICK_RESOLUTION_MINUTES } from "@/types/simulation";
import { createAppSyncClient } from "@/lib/appsync";

/**
 * Connects the simulation store to tick sources.
 *
 *   - If VITE_APPSYNC_ENDPOINT is set, subscribes to AppSync onTickUpdate.
 *   - Otherwise drives a deterministic client-side mock so the UI is
 *     functional before AWS is provisioned. The mock uses the same
 *     applyTickUpdate contract that the real subscription uses, so nothing
 *     downstream in the UI needs to change when the backend comes online.
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
        (t) => applyTickUpdate(t.tick, t.segmentUpdates, t.towns),
        (report) => completeSimulation(report),
        () => {
          /* surfaced via status */
        },
      );
    }

    // --- mock driver (used when VITE_APPSYNC_ENDPOINT is unset) ---
    const mockTowns: MockTown[] = [
      { townId: "t1", name: "Cairo", population: 2100, segmentId: "seg-42", crossAt: 6 },
      { townId: "t2", name: "Memphis", population: 633000, segmentId: "seg-118", crossAt: 14 },
      { townId: "t3", name: "Greenville", population: 29000, segmentId: "seg-214", crossAt: 22 },
      { townId: "t4", name: "Baton Rouge", population: 221000, segmentId: "seg-388", crossAt: 34 },
      { townId: "t5", name: "New Orleans", population: 383000, segmentId: "seg-501", crossAt: 46 },
    ];
    const priorRisk = new Map<string, RiskLevel>();
    const totalTicks = Math.max(24, Math.round(config.responseDelayHours + 24));
    const tickIntervalMs = Math.max(
      120,
      1000 * (TICK_RESOLUTION_MINUTES[config.tickResolution] / 60) * 0.5,
    );
    let tick = 0;

    const timer = window.setInterval(() => {
      tick += 1;

      const segmentUpdates: [string, SegmentState][] = [];
      for (let i = 0; i < 18; i++) {
        const segmentId = `seg-${i * 25 + Math.floor(tick / 2)}`;
        const concentration = Math.min(1, (tick - i) / 30);
        if (concentration <= 0) continue;
        segmentUpdates.push([segmentId, { concentration, riskLevel: classify(concentration) }]);
      }

      const towns: TownRisk[] = mockTowns.map((mt) => {
        const crossed = tick >= mt.crossAt;
        const ticksSince = Math.max(0, tick - mt.crossAt);
        const concentration = crossed ? Math.min(1, 0.2 + ticksSince * 0.05) : 0;
        const riskLevel: RiskLevel = crossed ? classify(concentration) : "CLEAR";
        return {
          townId: mt.townId,
          name: mt.name,
          population: mt.population,
          segmentId: mt.segmentId,
          riskLevel,
          tickCrossed: crossed ? mt.crossAt : null,
        };
      });

      for (const t of towns) {
        const prior = priorRisk.get(t.townId);
        if (prior !== t.riskLevel && t.riskLevel !== "CLEAR") {
          pushAlert({
            tick,
            townId: t.townId,
            townName: t.name,
            population: t.population,
            riskLevel: t.riskLevel,
            note: `Threshold crossed at tick ${tick}`,
          });
        }
        priorRisk.set(t.townId, t.riskLevel);
      }

      applyTickUpdate(tick, segmentUpdates, towns);

      if (tick >= totalTicks) {
        window.clearInterval(timer);
        const affectedTowns = mockTowns.filter((mt) => mt.crossAt <= totalTicks);
        const populationAtRisk = affectedTowns.reduce((sum, mt) => sum + mt.population, 0);
        completeSimulation({
          executiveSummary:
            `${formatGallons(config.volumeGallons)} of ${config.spillType.replace(/_/g, " ").toLowerCase()} released into the ${config.region} basin. With a ${config.responseDelayHours}h response delay, plume advected through ${affectedTowns.length} downstream municipalities before containment. Recommend immediate EPA Regional Response Team notification and downstream water utility isolation.`,
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

interface MockTown {
  townId: string;
  name: string;
  population: number;
  segmentId: string;
  crossAt: number;
}

function classify(concentration: number): RiskLevel {
  if (concentration >= 0.75) return "DANGER";
  if (concentration >= 0.45) return "ADVISORY";
  if (concentration >= 0.15) return "MONITOR";
  return "CLEAR";
}

function formatGallons(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M gallons`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K gallons`;
  return `${n} gallons`;
}
