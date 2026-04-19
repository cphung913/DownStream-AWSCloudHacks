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

// Cast to any to handle React 19-compiled Radix types under React 18 @types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Trigger = RadixSelect.Trigger as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Content = RadixSelect.Content as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Viewport = RadixSelect.Viewport as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Item = RadixSelect.Item as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Icon = RadixSelect.Icon as any;

export function Select<T extends string>({ value, onChange, options, placeholder, className }: Props<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <Trigger
        className={clsx(
          "inline-flex items-center justify-between gap-2 rounded-sm border border-border px-2.5 py-1.5 font-mono text-[11px] text-ink w-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          "bg-white/80 hover:bg-white transition-colors cursor-pointer",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <Icon className="text-ink-dim">▾</Icon>
      </Trigger>
      <RadixSelect.Portal>
        <Content
          className="z-[100] overflow-hidden rounded-sm bg-white border border-border shadow-panel"
          position="popper"
          sideOffset={4}
        >
          <Viewport className="p-1">
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </Viewport>
        </Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Item
      value={value}
      className="font-mono text-[11px] text-ink px-3 py-1.5 rounded-sm outline-none cursor-default
                 data-[highlighted]:bg-accent/20 data-[state=checked]:text-accent-strong"
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </Item>
  );
}
