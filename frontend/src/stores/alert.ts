import { create } from "zustand";
import type { RiskLevel } from "@/types/simulation";

export interface AlertEntry {
  id: string;
  tick: number;
  wallClock: number;
  townId: string;
  townName: string;
  population: number;
  riskLevel: RiskLevel;
  note?: string;
}

interface AlertState {
  entries: AlertEntry[];
  push: (entry: Omit<AlertEntry, "id" | "wallClock">) => void;
  clear: () => void;
}

const MAX_ENTRIES = 200;

export const useAlertStore = create<AlertState>((set) => ({
  entries: [],
  push: (partial) =>
    set((s) => ({
      entries: [
        { id: `a-${crypto.randomUUID()}`, wallClock: Date.now(), ...partial },
        ...s.entries,
      ].slice(0, MAX_ENTRIES),
    })),
  clear: () => set({ entries: [] }),
}));
