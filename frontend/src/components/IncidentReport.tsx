import { useSimulationStore } from "@/stores/simulation";

export function IncidentReport() {
  const report = useSimulationStore((s) => s.report);
  const status = useSimulationStore((s) => s.status);

  if (!report) {
    return (
      <div className="panel p-4 flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          Incident report
        </h3>
        <p className="text-xs text-ink-faint italic">
          {status === "running"
            ? "Generating after final tick…"
            : "Claude-drafted briefing will appear after simulation completes."}
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-4 flex flex-col gap-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
        Incident report
      </h3>

      <p className="text-sm text-ink leading-relaxed">{report.executiveSummary}</p>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Population at risk"
          value={report.populationAtRisk.toLocaleString()}
        />
        <Stat
          label="Est. cleanup"
          value={`$${(report.estimatedCleanupCost / 1_000_000).toFixed(2)}M`}
        />
      </div>

      <List label="Regulatory obligations" items={report.regulatoryObligations} />
      <List label="Mitigation priority" items={report.mitigationPriorityList} numbered />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elevated rounded-md border border-border px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-base font-mono text-ink mt-0.5">{value}</div>
    </div>
  );
}

function List({
  label,
  items,
  numbered = false,
}: {
  label: string;
  items: readonly string[];
  numbered?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <ol className="flex flex-col gap-1 text-[12px] text-ink-dim">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-accent font-mono text-[11px] pt-0.5">
              {numbered ? `${i + 1}.` : "·"}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
