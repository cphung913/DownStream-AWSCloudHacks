import { useState } from "react";
import { useSimulationStore } from "@/stores/simulation";
import { getIcs208Url } from "@/lib/appsync";

export function IncidentReport() {
  const report = useSimulationStore((s) => s.report);
  const status = useSimulationStore((s) => s.status);
  const simulationId = useSimulationStore((s) => s.simulationId);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  async function handleDownloadIcs208() {
    if (!simulationId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const url = await getIcs208Url(simulationId);
      if (!url) {
        setDownloadError("ICS-208 PDF not ready yet.");
        return;
      }
      // Trigger browser download
      const a = document.createElement("a");
      a.href = url;
      a.download = `ICS208-${simulationId.slice(0, 8)}.pdf`;
      a.click();
    } catch {
      setDownloadError("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
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

      {/* ICS-208 download */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-border">
        <span className="field-label">Official form</span>
        <button
          onClick={handleDownloadIcs208}
          disabled={downloading}
          className="flex items-center justify-center gap-2 w-full rounded-md border border-border bg-bg-elevated hover:bg-bg-hover active:scale-[0.98] transition-all px-3 py-2 text-xs font-medium text-ink disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <>
              <Spinner />
              Generating PDF…
            </>
          ) : (
            <>
              <DownloadIcon />
              Download ICS 208 Safety Message
            </>
          )}
        </button>
        {downloadError && (
          <p className="text-[11px] text-red-400">{downloadError}</p>
        )}
      </div>
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

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1v9m0 0L5 7m3 3 3-3M2 12v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
