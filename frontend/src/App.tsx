import { Map } from "./components/Map";
import { ControlPanel } from "./components/ControlPanel";
import { AlertFeed } from "./components/AlertFeed";
import { IncidentReport } from "./components/IncidentReport";
import { TimeScrubber } from "./components/TimeScrubber";
import { Header } from "./components/Header";

export function App() {
  return (
    <div className="h-full w-full flex flex-col">
      <Header />
      <div className="flex-1 relative overflow-hidden">
        <Map />
        <div className="absolute top-4 left-4 w-[360px] max-h-[calc(100%-2rem)] overflow-y-auto">
          <ControlPanel />
        </div>
        <div className="absolute top-4 right-4 w-[340px] max-h-[calc(100%-2rem)] flex flex-col gap-4 overflow-y-auto">
          <AlertFeed />
          <IncidentReport />
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(720px,calc(100%-2rem))]">
          <TimeScrubber />
        </div>
      </div>
    </div>
  );
}
