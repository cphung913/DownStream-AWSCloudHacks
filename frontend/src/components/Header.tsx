import { useSimulationStore } from "@/stores/simulation";

export function Header() {
  const status = useSimulationStore((s) => s.status);
  const region = useSimulationStore((s) => s.config.region);
  const tick = useSimulationStore((s) => s.tick);
  const volumeGallons = useSimulationStore((s) => s.config.volumeGallons);

  const sessionId = (volumeGallons % 9999).toString().padStart(4, "0");

  return (
    <header
      className="h-16 shrink-0 flex items-center px-7 border-b border-black/30 z-10"
      style={{ background: "#0e1a22", color: "#e8e4d8" }}
    >
      {/* Logo + title */}
      <div className="flex items-center gap-3.5">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" stroke="#7fb2c9" strokeWidth="1.5" />
          <path d="M 6,14 Q 10,10 14,14 T 22,14" stroke="#7fb2c9" strokeWidth="1.5" fill="none" />
          <path
            d="M 6,18 Q 10,14 14,18 T 22,18"
            stroke="#7fb2c9"
            strokeWidth="1.5"
            strokeOpacity="0.6"
            fill="none"
          />
        </svg>
        <div>
          <div
            className="text-[16px] font-semibold tracking-[0.15em] uppercase"
            style={{ color: "#e8e4d8" }}
          >
            Downstream · Watershed Simulator
          </div>
          <div className="font-mono text-[10px] tracking-[0.08em]" style={{ color: "#7fb2c9" }}>
            v2.3.1 · ref. 40 CFR 300 · session #WS-{sessionId}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      {/* Ribbon stats */}
      <div className="flex items-center gap-8">
        <RibbonStat label="BASIN" value={region} />
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: "#7fb2c9" }}>
            RUN
          </span>
          <span
            key={tick}
            className="font-mono text-[12px] tracking-[0.04em] animate-fade-in tabular-nums"
            style={{ color: "#e8e4d8" }}
          >
            {tick.toString().padStart(2, "0")}h
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: "#7fb2c9" }}>
            STATUS
          </span>
          <span
            className="font-mono text-[12px] tracking-[0.04em] flex items-center gap-1"
            style={{
              color:
                status === "running"
                  ? "#e8b64c"
                  : status === "completed"
                    ? "#7fb2c9"
                    : status === "error"
                      ? "#c8422b"
                      : "#e8e4d8",
            }}
          >
            <span className={status === "running" ? "animate-dot-pulse" : ""}>●</span>
            {status.toUpperCase()}
          </span>
        </div>
      </div>
    </header>
  );
}

function RibbonStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: "#7fb2c9" }}>
        {label}
      </span>
      <span
        className="font-mono text-[12px] tracking-[0.04em]"
        style={{ color: accent ?? "#e8e4d8" }}
      >
        {value}
      </span>
    </div>
  );
}
