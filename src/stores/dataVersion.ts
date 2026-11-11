import { create } from 'zustand';

/**
 * Monotonic counter bumped when data changes outside the current screen's control
 * (background metadata fetch, share intake, import). Screens add it to their reload deps.
 */
export const useDataVersion = create<{ version: number; bump(): void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
