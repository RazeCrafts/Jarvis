import { create } from "zustand";
import type { Artifact } from "@/lib/artifacts";

interface WorkspaceState {
  artifacts: Artifact[];
  activeId: string | null;
  addArtifacts: (artifacts: Artifact[]) => void;
  /** Replace by id (new version / undo / activate) and focus it. */
  upsertArtifact: (artifact: Artifact) => void;
  /** Replace the whole list (sync from the backend). */
  replaceArtifacts: (artifacts: Artifact[]) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  artifacts: [],
  activeId: null,
  addArtifacts: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return s;
      const artifacts = [...s.artifacts, ...incoming];
      return { artifacts, activeId: incoming[incoming.length - 1].id };
    }),
  upsertArtifact: (artifact) =>
    set((s) => {
      const index = s.artifacts.findIndex((item) => item.id === artifact.id);
      const artifacts =
        index === -1
          ? [...s.artifacts, artifact]
          : s.artifacts.map((item) => (item.id === artifact.id ? artifact : item));
      return { artifacts, activeId: artifact.id };
    }),
  replaceArtifacts: (incoming) =>
    set((s) => {
      const keep = incoming.some((item) => item.id === s.activeId);
      return {
        artifacts: incoming,
        activeId: keep ? s.activeId : (incoming[incoming.length - 1]?.id ?? null),
      };
    }),
  setActive: (activeId) => set({ activeId }),
  clear: () => set({ artifacts: [], activeId: null }),
}));
