import { useAlertStore } from "@/stores/alert";
import { clsx } from "clsx";
import type { RiskLevel } from "@/types/simulation";

const RISK_CLASS: Record<RiskLevel, string> = {
  CLEAR: "bg-risk-clear/15 border-risk-clear/40 text-risk-clear",
  MONITOR: "bg-risk-monitor/15 border-risk-monitor/40 text-risk-monitor",
  ADVISORY: "bg-risk-advisory/15 border-risk-advisory/40 text-risk-advisory",
  DANGER: "bg-risk-danger/15 border-risk-danger/40 text-risk-danger",
};

export function AlertFeed() {
  const entries = useAlertStore((s) => s.entries);
  const clear = useAlertStore((s) => s.clear);

  return (
    <div className="panel p-4 flex flex-col gap-3 max-h-[46%]">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          Alert feed
        </h3>
        {entries.length ? (
          <button onClick={clear} className="text-[11px] text-ink-faint hover:text-ink">
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <p className="text-xs text-ink-faint italic">
            Threshold-crossing events from EventBridge will stream in here.
          </p>
        ) : (
          entries.map((a) => (
            <div
              key={a.id}
              className={clsx(
                "rounded-md border px-2.5 py-1.5 text-xs flex items-start gap-2",
                RISK_CLASS[a.riskLevel],
              )}
            >
              <span className="font-mono text-[10px] opacity-70 mt-0.5">t+{a.tick}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink truncate">{a.townName}</div>
                <div className="text-[11px] text-ink-dim">
                  {a.riskLevel} · pop {a.population.toLocaleString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
