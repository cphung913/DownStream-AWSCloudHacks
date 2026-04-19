import * as RadixSlider from "@radix-ui/react-slider";
import { clsx } from "clsx";

interface Props {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  "aria-label"?: string;
}

// Cast to any to handle React 19-compiled Radix types under React 18 @types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Root = RadixSlider.Root as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Track = RadixSlider.Track as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Range = RadixSlider.Range as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Thumb = RadixSlider.Thumb as any;

export function Slider({ value, onChange, min, max, step = 1, className, ...rest }: Props) {
  return (
    <Root
      className={clsx("relative flex items-center h-5 select-none touch-none w-full", className)}
      value={[value]}
      onValueChange={([v]: number[]) => onChange(v!)}
      min={min}
      max={max}
      step={step}
      aria-label={rest["aria-label"]}
    >
      <Track className="relative grow h-[2px]" style={{ background: "rgba(0,0,0,0.12)" }}>
        <Range className="absolute h-full" style={{ background: "#2d5a7a" }} />
      </Track>
      <Thumb
        className="block h-3 w-3 rounded-full shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-grab"
        style={{ background: "#fff", border: "2px solid #2d5a7a" }}
      />
    </Root>
  );
}
