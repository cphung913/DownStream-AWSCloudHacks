import { Map } from "./components/Map";
import { ControlPanel } from "./components/ControlPanel";
import { AlertFeed } from "./components/AlertFeed";
import { IncidentReport } from "./components/IncidentReport";
import { TimeScrubber } from "./components/TimeScrubber";
import { Header } from "./components/Header";

export function App() {
  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <Header />
      {/* Three-column instrument layout */}
      <div
        className="flex-1 overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: "320px 1fr 380px", minHeight: 0 }}
      >
        {/* Left: scenario inputs */}
        <div className="bg-bg-panel border-r border-border overflow-y-auto">
          <ControlPanel />
        </div>

        {/* Center: map + timeline strip */}
        <div className="flex flex-col min-h-0 border-r border-border">
          <div className="flex-1 relative min-h-0">
            <Map />
          </div>
          <TimeScrubber />
        </div>

        {/* Right: cost report + alert feed */}
        <div className="overflow-y-auto flex flex-col divide-y divide-border">
          <IncidentReport />
          <AlertFeed />
        </div>
      </div>
    </div>
  );
}
