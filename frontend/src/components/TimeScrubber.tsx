import { useSimulationStore } from "@/stores/simulation";
import { Slider } from "./ui/Slider";

export function TimeScrubber() {
  const tick = useSimulationStore((s) => s.tick);
  const totalTicks = useSimulationStore((s) => s.totalTicks);
  const status = useSimulationStore((s) => s.status);
  const setTick = useSimulationStore((s) => s.setTick);

  if (status === "idle" || totalTicks === 0) return null;

  return (
    <div className="panel px-4 py-3 flex items-center gap-3">
      <span className="font-mono text-[11px] text-ink-dim whitespace-nowrap">
        t+{tick} / {totalTicks}
      </span>
      <Slider
        value={tick}
        onChange={setTick}
        min={0}
        max={totalTicks}
        step={1}
        aria-label="tick scrubber"
      />
      <span className="text-[11px] text-ink-faint whitespace-nowrap">
        {status === "running" ? "live" : status === "completed" ? "scrub" : ""}
      </span>
    </div>
  );
}
