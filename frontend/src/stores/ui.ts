import { create } from "zustand";
import type { MitigationKind } from "@/types/simulation";

export type MapMode = "inspect" | "pinSource" | "placeMitigation";

interface UiState {
  mode: MapMode;
  pendingMitigationKind: MitigationKind | null;
  pendingMitigationRadius: number;

  setMode: (mode: MapMode) => void;
  armPinSource: () => void;
  armMitigation: (kind: MitigationKind, radiusMeters: number) => void;
  cancel: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: "inspect",
  pendingMitigationKind: null,
  pendingMitigationRadius: 500,

  setMode: (mode) => set({ mode }),
  armPinSource: () => set({ mode: "pinSource", pendingMitigationKind: null }),
  armMitigation: (kind, radiusMeters) =>
    set({ mode: "placeMitigation", pendingMitigationKind: kind, pendingMitigationRadius: radiusMeters }),
  cancel: () => set({ mode: "inspect", pendingMitigationKind: null }),
}));
