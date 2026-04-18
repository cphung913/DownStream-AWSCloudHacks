import * as RadixSelect from "@radix-ui/react-select";
import { clsx } from "clsx";
import type { ReactNode } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<Option<T>>;
  placeholder?: string;
  className?: string;
}

export function Select<T extends string>({ value, onChange, options, placeholder, className }: Props<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RadixSelect.Trigger
        className={clsx(
          "inline-flex items-center justify-between gap-2 rounded-md bg-bg-elevated border border-border px-3 py-2 text-sm text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent w-full",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-ink-dim">▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="z-[100] overflow-hidden rounded-md bg-bg-elevated border border-border shadow-panel"
          position="popper"
          sideOffset={4}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <Item key={o.value} value={o.value}>
                {o.label}
              </Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function Item({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixSelect.Item
      value={value}
      className="text-sm text-ink px-3 py-1.5 rounded-sm outline-none cursor-default
                 data-[highlighted]:bg-accent-strong/20 data-[state=checked]:text-accent"
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
