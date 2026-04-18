import { useSimulationStore } from "@/stores/simulation";
import { useUiStore } from "@/stores/ui";
import { Slider } from "./ui/Slider";
import { Select } from "./ui/Select";
import { NumberInput } from "./ui/NumberInput";
import {
  MITIGATION_COST,
  MITIGATION_LABEL,
  REGION_LABEL,
  SPILL_TYPE_LABEL,
  type MitigationKind,
  type Region,
  type SpillType,
  type TickResolution,
} from "@/types/simulation";

const REGION_OPTIONS = (Object.keys(REGION_LABEL) as Region[]).map((v) => ({
  value: v,
  label: REGION_LABEL[v],
}));

const SPILL_TYPE_OPTIONS = (Object.keys(SPILL_TYPE_LABEL) as SpillType[]).map((v) => ({
  value: v,
  label: SPILL_TYPE_LABEL[v],
}));

const TICK_OPTIONS: ReadonlyArray<{ value: TickResolution; label: string }> = [
  { value: "FIFTEEN_MIN", label: "15 min" },
  { value: "ONE_HOUR", label: "1 hour (default)" },
  { value: "SIX_HOURS", label: "6 hours" },
];

const MITIGATION_KINDS: ReadonlyArray<MitigationKind> = [
  "CONTAINMENT_BARRIER",
  "BOOM_DEPLOYMENT",
  "BIOREMEDIATION",
  "EMERGENCY_DIVERSION",
];

export function ControlPanel() {
  const config = useSimulationStore((s) => s.config);
  const status = useSimulationStore((s) => s.status);
  const sourceSegmentId = useSimulationStore((s) => s.config.sourceSegmentId);
  const barriers = useSimulationStore((s) => s.barriers);
  const remainingBudget = useSimulationStore((s) => s.remainingBudget);
  const canAfford = useSimulationStore((s) => s.canAfford);

  const setRegion = useSimulationStore((s) => s.setRegion);
  const setSpillType = useSimulationStore((s) => s.setSpillType);
  const setVolumeGallons = useSimulationStore((s) => s.setVolumeGallons);
  const setTemperatureC = useSimulationStore((s) => s.setTemperatureC);
  const setResponseDelayHours = useSimulationStore((s) => s.setResponseDelayHours);
  const setBudgetCapUsd = useSimulationStore((s) => s.setBudgetCapUsd);
  const setTickResolution = useSimulationStore((s) => s.setTickResolution);
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const resetSimulation = useSimulationStore((s) => s.resetSimulation);
  const removeBarrier = useSimulationStore((s) => s.removeBarrier);

  const mode = useUiStore((s) => s.mode);
  const pendingKind = useUiStore((s) => s.pendingMitigationKind);
  const armPinSource = useUiStore((s) => s.armPinSource);
  const armMitigation = useUiStore((s) => s.armMitigation);
  const cancel = useUiStore((s) => s.cancel);

  const canSimulate = !!sourceSegmentId && status !== "running";

  return (
    <div className="panel p-4 flex flex-col gap-5">
      <Section title="Scenario">
        <Field label="Watershed">
          <Select value={config.region} onChange={setRegion} options={REGION_OPTIONS} />
        </Field>
        <Field label="Spill source">
          <div className="flex items-center gap-2">
            <button
              className={mode === "pinSource" ? "btn-primary flex-1" : "btn-ghost flex-1"}
              onClick={mode === "pinSource" ? cancel : armPinSource}
            >
              {mode === "pinSource" ? "Cancel" : sourceSegmentId ? "Re-pin on map" : "Pin on map"}
            </button>
            {sourceSegmentId ? (
              <span className="chip font-mono text-[11px]" title={sourceSegmentId}>
                {sourceSegmentId.slice(0, 12)}
              </span>
            ) : (
              <span className="text-xs text-ink-faint">not set</span>
            )}
          </div>
        </Field>
      </Section>

      <Section title="Hazard">
        <Field label="Spill type">
          <Select value={config.spillType} onChange={setSpillType} options={SPILL_TYPE_OPTIONS} />
        </Field>
        <Field label="Volume (gallons)">
          <NumberInput
            value={config.volumeGallons}
            onChange={setVolumeGallons}
            min={0}
            step={500}
            suffix="gal"
          />
        </Field>
        <Field label={`Ambient water temp · ${config.temperatureC.toFixed(1)} °C`}>
          <Slider value={config.temperatureC} onChange={setTemperatureC} min={0} max={35} step={0.5} />
        </Field>
      </Section>

      <Section title="Timing">
        <Field label={`Response delay · ${config.responseDelayHours}h`}>
          <Slider
            value={config.responseDelayHours}
            onChange={setResponseDelayHours}
            min={0}
            max={72}
            step={1}
          />
          <div className="flex justify-between text-[10px] text-ink-faint mt-1 font-mono">
            <span>0h</span>
            <span>24h</span>
            <span>48h</span>
            <span>72h</span>
          </div>
        </Field>
        <Field label="Tick resolution">
          <Select value={config.tickResolution} onChange={setTickResolution} options={TICK_OPTIONS} />
        </Field>
      </Section>

      <Section title="Mitigation">
        <Field label={`Budget cap · $${(config.budgetCapUsd / 1000).toFixed(0)}k`}>
          <Slider
            value={config.budgetCapUsd}
            onChange={setBudgetCapUsd}
            min={100_000}
            max={5_000_000}
            step={50_000}
          />
          <div className="flex justify-between text-[11px] text-ink-dim mt-1 font-mono">
            <span>spent ${((config.budgetCapUsd - remainingBudget()) / 1000).toFixed(0)}k</span>
            <span>remaining ${(remainingBudget() / 1000).toFixed(0)}k</span>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          {MITIGATION_KINDS.map((kind) => {
            const cost = MITIGATION_COST[kind];
            const affordable = canAfford(kind);
            const armed = mode === "placeMitigation" && pendingKind === kind;
            return (
              <button
                key={kind}
                disabled={!affordable && !armed}
                onClick={armed ? cancel : () => armMitigation(kind, 500)}
                className={
                  armed
                    ? "btn-primary text-xs flex flex-col items-start py-2 px-2.5 gap-0.5"
                    : "btn-ghost text-xs flex flex-col items-start py-2 px-2.5 gap-0.5 disabled:opacity-40"
                }
                title={affordable ? "Arm, then click on the map" : "Insufficient remaining budget"}
              >
                <span className="font-medium">{MITIGATION_LABEL[kind]}</span>
                <span className="text-[10px] font-mono opacity-70">
                  ${(cost / 1000).toFixed(0)}k
                </span>
              </button>
            );
          })}
        </div>

        {barriers.length > 0 ? (
          <div className="flex flex-col gap-1 mt-2">
            <span className="field-label">Placed ({barriers.length})</span>
            {barriers.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-xs font-mono text-ink-dim">
                <span>
                  {MITIGATION_LABEL[b.kind]} · {b.segmentId.slice(0, 10)}
                </span>
                <button
                  className="text-ink-faint hover:text-risk-danger"
                  onClick={() => removeBarrier(b.id)}
                  aria-label="remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <div className="flex items-center gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!canSimulate}
          onClick={startSimulation}
          title={!sourceSegmentId ? "Pin a source on the map first" : undefined}
        >
          {status === "running" ? "Running…" : status === "completed" ? "Re-run" : "Simulate"}
        </button>
        {status !== "idle" ? (
          <button className="btn-ghost" onClick={resetSimulation}>
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
