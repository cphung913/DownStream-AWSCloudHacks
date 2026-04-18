import { useCallback } from "react";
import * as Slider from "@radix-ui/react-slider";
import { useSimulationStore } from "../stores/simulation";
import { getTickSnapshot } from "../lib/appsync";

export function TimeSlider(): JSX.Element {
  const simulationId = useSimulationStore((s) => s.simulationId);
  const tick = useSimulationStore((s) => s.tick);
  const totalTicks = useSimulationStore((s) => s.totalTicks);
  const replaceSegmentMap = useSimulationStore((s) => s.replaceSegmentMap);

  const onScrub = useCallback(
    async (value: number[]) => {
      const target = value[0];
      if (!simulationId || target === undefined) return;
      const snap = await getTickSnapshot(simulationId, target);
      if (snap) {
        replaceSegmentMap(snap.segmentUpdates, snap.tick);
      }
    },
    [simulationId, replaceSegmentMap],
  );

  return (
    <div className="flex items-center gap-3 text-xs text-slate-300">
      <span>Tick</span>
      <Slider.Root
        className="relative flex items-center select-none touch-none w-full h-5"
        value={[tick]}
        min={0}
        max={totalTicks}
        step={1}
        onValueChange={onScrub}
        aria-label="Time slider"
      >
        <Slider.Track className="bg-slate-700 relative grow h-1 rounded">
          <Slider.Range className="absolute bg-blue-500 h-full rounded" />
        </Slider.Track>
        <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </Slider.Root>
      <span className="font-mono w-12 text-right">
        {tick}/{totalTicks}
      </span>
    </div>
  );
}
