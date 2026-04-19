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
  { value: "FIFTEEN_MIN", label: "15 minutes" },
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
    <div className="p-5 flex flex-col gap-0">
      {/* Section 01: Scenario */}
      <h1 className="text-xl font-bold mb-4">Scenario Inputs</h1>

      <InputBlock label="Watershed">
        <Select value={config.region} onChange={setRegion} options={REGION_OPTIONS} />
      </InputBlock>

      <InputBlock
        label="Spill origin"
        helper={sourceSegmentId ? sourceSegmentId.slice(0, 14) : undefined}
      >
        <div className="flex items-center gap-2">
          <button
            className={
              mode === "pinSource"
                ? "btn-primary flex-1"
                : "btn-ghost flex-1"
            }
            onClick={mode === "pinSource" ? cancel : armPinSource}
          >
            {mode === "pinSource"
              ? "Cancel"
              : sourceSegmentId
                ? "Re-pin on map"
                : "Pin on map"}
          </button>
        </div>
      </InputBlock>

      <DividerLabel>Hazard</DividerLabel>

      <InputBlock label="Spill type">
        <Select value={config.spillType} onChange={setSpillType} options={SPILL_TYPE_OPTIONS} />
      </InputBlock>

      <InputBlock label="Volume" helper={`≈ ${fmtGal(config.volumeGallons)}`}>
        <NumberInput
          value={config.volumeGallons}
          onChange={setVolumeGallons}
          min={0}
          step={500}
          suffix="gal"
        />
      </InputBlock>

      <DividerLabel>Timing</DividerLabel>

      <InputBlock label={`Response delay · ${config.responseDelayHours}h`}>
        <Slider
          value={config.responseDelayHours}
          onChange={setResponseDelayHours}
          min={0}
          max={72}
          step={1}
        />
        <RangeTicks ticks={["0h", "24h", "48h", "72h"]} />
      </InputBlock>

      <InputBlock label="Tick resolution">
        <Select
          value={config.tickResolution}
          onChange={setTickResolution}
          options={TICK_OPTIONS}
        />
      </InputBlock>

      <DividerLabel>Mitigation</DividerLabel>

      <InputBlock label={`Budget cap · ${formatUsd(config.budgetCapUsd)}`}>
        <Slider
          value={config.budgetCapUsd}
          onChange={setBudgetCapUsd}
          min={500_000}
          max={15_000_000}
          step={100_000}
        />
        <div className="flex justify-between font-mono text-[10px] text-ink-faint mt-1">
          <span>spent {formatUsd(config.budgetCapUsd - remainingBudget())}</span>
          <span>rem. {formatUsd(remainingBudget())}</span>
        </div>
      </InputBlock>

      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {MITIGATION_KINDS.map((kind) => {
          const cost = MITIGATION_COST[kind];
          const affordable = canAfford(kind);
          const armed = mode === "placeMitigation" && pendingKind === kind;
          return (
            <button
              key={kind}
              disabled={!affordable && !armed}
              onClick={armed ? cancel : () => armMitigation(kind, 500)}
              className={[
                "flex flex-col items-start py-2 px-2.5 rounded-sm border text-[10px] font-mono",
                "transition-colors disabled:opacity-40",
                armed
                  ? "bg-bg-ribbon text-ink-ribbon border-bg-ribbon ring-1 ring-accent ring-offset-1 ring-offset-bg-panel animate-dot-pulse"
                  : "bg-transparent text-ink border-border hover:border-border-strong",
              ].join(" ")}
              title={
                affordable
                  ? "Arm, then click on the map"
                  : "Insufficient remaining budget"
              }
            >
              <span className="font-medium tracking-wide">
                {MITIGATION_LABEL[kind]}
              </span>
              <span className="text-[9px] opacity-60 mt-0.5">{formatUsd(cost)}</span>
            </button>
          );
        })}
      </div>

      {barriers.length > 0 && (
        <div className="flex flex-col gap-1 mb-4">
          <span className="field-label">Placed ({barriers.length})</span>
          {barriers.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between text-[11px] font-mono text-ink-dim"
            >
              <span>
                {MITIGATION_LABEL[b.kind]} · {b.segmentId.slice(0, 10)}
              </span>
              <button
                className="text-ink-faint hover:text-accent-danger"
                onClick={() => removeBarrier(b.id)}
                aria-label="remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          className="btn-primary flex-1"
          disabled={!canSimulate}
          onClick={startSimulation}
          title={!sourceSegmentId ? "Pin a source on the map first" : undefined}
        >
          {status === "running"
            ? "Running…"
            : status === "completed"
              ? "Re-run"
              : "Simulate"}
        </button>
        {status !== "idle" && (
          <button className="btn-ghost" onClick={resetSimulation}>
            Reset
          </button>
        )}
      </div>

      
    </div>
  );
}

function InputBlock({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="field-label">{label}</span>
        {helper && (
          <span className="font-mono text-[9px] text-ink-faint">{helper}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function DividerLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-divider mb-3">{children}</div>
  );
}

function RangeTicks({ ticks }: { ticks: string[] }) {
  return (
    <div className="flex justify-between mt-1 font-mono text-[9px] text-ink-faint">
      {ticks.map((t, i) => (
        <span key={i}>{t}</span>
      ))}
    </div>
  );
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  return `$${(n / 1000).toFixed(0)}k`;
}

function fmtGal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M gal`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K gal`;
  return `${n} gal`;
}
