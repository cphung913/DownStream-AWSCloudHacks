import { clsx } from "clsx";

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  "aria-label"?: string;
}

export function NumberInput({ value, onChange, min, max, step, suffix, className, ...rest }: Props) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        aria-label={rest["aria-label"]}
        className="bg-white/80 border border-border rounded-sm px-2.5 py-1.5 text-[11px] text-ink w-full font-mono
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:bg-white transition-colors"
      />
      {suffix ? <span className="text-xs text-ink-dim font-mono">{suffix}</span> : null}
    </div>
  );
}
