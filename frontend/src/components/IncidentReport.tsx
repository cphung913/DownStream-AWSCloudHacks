import { useState } from "react";
import { useSimulationStore } from "@/stores/simulation";
import { getIcs208Url } from "@/lib/appsync";
import { useCountUp } from "@/hooks/useCountUp";

export function IncidentReport() {
  const report = useSimulationStore((s) => s.report);
  const status = useSimulationStore((s) => s.status);
  const simulationId = useSimulationStore((s) => s.simulationId);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const townRiskMap = useSimulationStore((s) => s.townRiskMap);
  const volumeGallons = useSimulationStore((s) => s.config.volumeGallons);
  const totalMitigationCost = useSimulationStore((s) => s.totalMitigationCost);

  const livePop = Array.from(townRiskMap.values())
    .filter((t) => t.riskLevel !== "CLEAR")
    .reduce((sum, t) => sum + t.population, 0);
  const mitigationSpend = totalMitigationCost();
  const liveCleanup = Math.round(volumeGallons * 180 + livePop * 12);
  const liveCost = liveCleanup + mitigationSpend;

  const hasScrubData = townRiskMap.size > 0;
  const totalCost = hasScrubData ? liveCost : (report ? report.estimatedCleanupCost + mitigationSpend : 0);
  const popAtRisk = hasScrubData ? livePop : (report?.populationAtRisk ?? 0);

  const animatedCost = useCountUp(totalCost);
  const animatedPop = useCountUp(popAtRisk);
  const animatedCleanup = useCountUp(liveCleanup);
  const animatedMitigation = useCountUp(mitigationSpend);

  if (!report && !hasScrubData) {
    return (
      <div className="p-5 flex flex-col gap-2">
        <h1 className="text-xl font-bold mb-4">Estimated Cost Report</h1>
        <p className="font-mono text-[11px] text-ink-faint italic">
          {status === "running"
            ? "Generating after final tick…"
            : "AI-drafted briefing will appear after simulation completes."}
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
    <div className="p-5 flex flex-col gap-5 animate-fade-in">
      <h1 className="text-xl font-bold mb-4">Estimated Cost Report</h1>

      {/* Hero cost number */}
      <div>
        <div className="field-label mb-1">Total estimated cost · USD</div>
        <div
          key={Math.round(animatedCost / 10_000)}
          className="text-[56px] font-light leading-none tracking-tight animate-number-flash"
          style={{ color: "#a63d2a", fontFamily: "'Inter Tight', sans-serif" }}
        >
          ${(animatedCost / 1_000_000).toFixed(2)}M
        </div>
        <div className="font-mono text-[10px] text-ink-faint mt-1.5">± 14% (90% CI)</div>
      </div>

      {/* Stats grid */}
      <div
        className="grid grid-cols-2 gap-px"
        style={{ background: "rgba(0,0,0,0.1)" }}
      >
        <StatCell label="Population at risk" value={animatedPop.toLocaleString()} sub="downstream intakes" />
        <StatCell label="Est. cleanup" value={`$${(animatedCleanup / 1_000_000).toFixed(2)}M`} sub="remediation only" />
        {mitigationSpend > 0 && (
          <StatCell label="Mitigation spend" value={`$${(animatedMitigation / 1_000_000).toFixed(2)}M`} sub="barriers placed" />
        )}
        {mitigationSpend > 0 && (
          <StatCell label="Total cost" value={`$${(animatedCost / 1_000_000).toFixed(2)}M`} sub="cleanup + mitigation" />
        )}
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
      {/* Narrative sections — only available after simulation completes */}
      {report && (
        <div className="flex flex-col gap-5 animate-slide-up">
          <div>
            <Subhead>Summary</Subhead>
            <p className="text-[13px] leading-relaxed text-ink">{report.executiveSummary}</p>
          </div>

          <div>
            <Subhead>Mitigation priority</Subhead>
            <ol className="flex flex-col gap-0">
              {report.mitigationPriorityList.map((item, i) => (
                <li
                  key={i}
                  className="flex gap-3 py-2 border-b border-dashed border-border last:border-0 text-[12px] leading-relaxed animate-slide-right"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span
                    className="font-mono text-[10px] font-semibold shrink-0 pt-0.5"
                    style={{ color: "#a63d2a", minWidth: 20 }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-ink">{item}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <Subhead>Regulatory obligations</Subhead>
            <ul className="flex flex-col gap-0">
              {report.regulatoryObligations.map((item, i) => (
                <li
                  key={i}
                  className="flex gap-3 py-2 border-b border-dashed border-border last:border-0 text-[12px] leading-relaxed animate-slide-right"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="text-ink-faint shrink-0 pt-0.5">·</span>
                  <span className="text-ink-dim">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="p-3.5 font-mono text-[10px] leading-relaxed text-ink-dim animate-fade-in"
            style={{
              borderLeft: "3px solid #0e1a22",
              background: "#ebe6d6",
              animationDelay: "200ms",
            }}
          >
            <div
              className="font-semibold tracking-[0.12em] mb-1"
              style={{ color: "#0e1a22" }}
            >
              REGULATORY FILING — AUTO-GENERATED
            </div>
            Within 1 hour: EPA National Contingency Plan activation (40 CFR 300). Within 15 min:
            EPCRA Emergency Release Notification to SERC / LEPC (40 CFR 355). CWA §311 notification
            to National Response Center 1-800-424-8802.
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-bg p-3.5">
      <div className="field-label mb-1">{label}</div>
      <div
        className="text-[22px] font-medium tracking-tight leading-none tabular-nums"
        style={{ fontFamily: "'Inter Tight', sans-serif" }}
      >
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[10px] text-ink-faint mt-1">{sub}</div>
      )}
    </div>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase text-ink-dim mb-2">
      {children}
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
