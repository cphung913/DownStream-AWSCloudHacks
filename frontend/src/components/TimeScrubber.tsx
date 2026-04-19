import { useSimulationStore } from "@/stores/simulation";
import { Slider } from "./ui/Slider";

export function TimeScrubber() {
  const tick = useSimulationStore((s) => s.tick);
  const totalTicks = useSimulationStore((s) => s.totalTicks);
  const status = useSimulationStore((s) => s.status);
  const setTick = useSimulationStore((s) => s.setTick);

  if (status === "idle" || totalTicks === 0) return null;

  return (
    <div
      className="px-5 py-3.5 border-t border-border"
      style={{ background: "#f4f1e8" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="font-mono text-[9px] tracking-[0.14em] uppercase"
          style={{ color: "rgba(0,0,0,0.6)" }}
        >
          Timeline
        </span>
        <span className="font-mono text-[10px]" style={{ color: "#a63d2a" }}>
          {(tick+1).toString().padStart(2, "0")} / {totalTicks +1}
          {status === "running" ? " · live" : status === "completed" ? " · completed" : ""}
        </span>
      </div>

      <Slider
        value={tick}
        onChange={setTick}
        min={0}
        max={totalTicks}
        step={1}
        aria-label="tick scrubber"
      />

      <div
        className="flex justify-between mt-1.5 font-mono text-[9px]"
        style={{ color: "rgba(0,0,0,0.4)" }}
      >
        <span>0hr</span>
        <span>{Math.round(totalTicks * 0.25).toString().padStart(2, "0")}hr</span>
        <span>{Math.round(totalTicks * 0.5).toString().padStart(2, "0")}hr</span>
        <span>{Math.ceil(totalTicks * 0.75).toString().padStart(2, "0")}hr</span>
        <span>{totalTicks +1}hr</span>
      </div>
    </div>
  );
}
