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

export function Slider({ value, onChange, min, max, step = 1, className, ...rest }: Props) {
  return (
    <RadixSlider.Root
      className={clsx("relative flex items-center h-5 select-none touch-none w-full", className)}
      value={[value]}
      onValueChange={([v]) => onChange(v!)}
      min={min}
      max={max}
      step={step}
      aria-label={rest["aria-label"]}
    >
      <RadixSlider.Track className="bg-bg-elevated relative grow rounded-full h-[3px]">
        <RadixSlider.Range className="absolute bg-accent-strong rounded-full h-full" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="block h-4 w-4 rounded-full bg-ink border-2 border-accent-strong shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    </RadixSlider.Root>
  );
}
