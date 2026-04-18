import { useSimulationStore } from "@/stores/simulation";

export function Header() {
  const status = useSimulationStore((s) => s.status);
  const region = useSimulationStore((s) => s.config.region);
  const tick = useSimulationStore((s) => s.tick);

  return (
    <header className="h-12 flex items-center justify-between px-5 bg-bg-panel border-b border-border shrink-0 z-10">
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 rounded-sm bg-accent-strong shadow-[0_0_14px_rgba(14,165,233,0.45)]" />
        <h1 className="text-sm font-semibold tracking-wide">Watershed Spill Simulator</h1>
        <span className="chip uppercase text-[10px]">{region}</span>
      </div>
      <div className="flex items-center gap-4">
        <StatusPill status={status} />
        {status === "running" ? (
          <span className="font-mono text-xs text-ink-dim">tick {tick}</span>
        ) : null}
      </div>
    </header>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-risk-monitor/20 text-risk-monitor border-risk-monitor/50"
      : status === "completed"
        ? "bg-risk-clear/20 text-risk-clear border-risk-clear/50"
        : status === "error"
          ? "bg-risk-danger/20 text-risk-danger border-risk-danger/50"
          : "bg-bg-elevated text-ink-dim border-border";
  return (
    <span className={`chip uppercase text-[10px] ${cls}`}>{status}</span>
  );
}
