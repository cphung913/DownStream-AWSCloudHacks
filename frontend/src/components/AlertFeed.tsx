import { useAlertStore } from "@/stores/alert";
import type { RiskLevel } from "@/types/simulation";

const RISK_DOT: Record<RiskLevel, string> = {
  CLEAR: "#22c55e",
  MONITOR: "#ca8a04",
  ADVISORY: "#ea580c",
  DANGER: "#dc2626",
};

export function AlertFeed() {
  const entries = useAlertStore((s) => s.entries);

  return (
    <div className="p-5 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <span className="field-label">Alert feed</span>
      </div>

      {entries.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-faint italic">
          Threshold-crossing events will stream in here.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2.5 py-1.5 border-b border-border last:border-0 animate-slide-down"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                style={{ background: RISK_DOT[a.riskLevel] }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink truncate">
                    {a.townName}
                  </span>
                  <span className="font-mono text-[10px] text-ink-faint shrink-0">
                    {a.tick}hr
                  </span>
                </div>
                <div className="font-mono text-[10px] text-ink-dim mt-0.5">
                  {a.riskLevel} · pop {a.population.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
