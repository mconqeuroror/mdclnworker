import { create } from "zustand";
import { persist } from "zustand/middleware";
import { queryClient } from "../lib/queryClient";

// ✅ v40 HELPER: Add computed totalCredits to user object (exported for 401-refresh path)
export function enrichUserWithTotalCredits(user) {
  if (!user) return null;

  // Always re-compute from the three raw pools. Coerce to numbers to avoid NaN from corrupted storage.
  const legacy = Number(user._legacyCredits ?? user.credits ?? 0) || 0;
  const subscription = Number(user._subscriptionCredits ?? user.subscriptionCredits ?? 0) || 0;
  const purchased = Number(user._purchasedCredits ?? user.purchasedCredits ?? 0) || 0;
  const totalCredits = Math.max(0, legacy + subscription + purchased);

  return {
    ...user,
    _legacyCredits: legacy,
    _subscriptionCredits: subscription,
    _purchasedCredits: purchased,
    credits: totalCredits, // ✅ Override with TOTAL credits for UI display
  };
}

// Never overwrite good credit values with undefined when merging server response
function mergeCreditFields(existing, incoming) {
  if (!incoming) return existing;
  return {
    credits: typeof incoming.credits === "number" ? incoming.credits : (existing?.credits ?? 0),
    subscriptionCredits: typeof incoming.subscriptionCredits === "number" ? incoming.subscriptionCredits : (existing?.subscriptionCredits ?? 0),
    purchasedCredits: typeof incoming.purchasedCredits === "number" ? incoming.purchasedCredits : (existing?.purchasedCredits ?? 0),
  };
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      telegramUser: null,
      isAuthenticated: false,

      setAuth: (user, token = null) => {
        set({
          user: enrichUserWithTotalCredits(user),
          token: token || null,
          isAuthenticated: true,
        });
        // Ensure models and generations refetch for this user (fixes empty load for some users)
        queryClient.invalidateQueries({ queryKey: ["/api/models"] });
        queryClient.invalidateQueries({ queryKey: ["/api/generations"] });
      },

      setTelegramUser: (telegramUser) => {
        set({ telegramUser: telegramUser || null });
      },

      logout: async () => {
        try {
          const { authAPI } = await import("../services/api");
          await authAPI.logout();
        } catch (error) {
          console.error("Logout API error (ignoring):", error);
        }
        set({
          user: null,
          token: null,
          telegramUser: null,
          isAuthenticated: false,
        });
        // Clear cached models/generations so next user doesn't see stale data
        queryClient.removeQueries({ queryKey: ["/api/models"] });
        queryClient.removeQueries({ queryKey: ["/api/generations"] });
      },

      updateUser: (userData) =>
        set((state) => {
          if (!state.user) return { user: null };
          const existing = state.user;
          const safe = mergeCreditFields(
            {
              credits: existing._legacyCredits ?? existing.credits,
              subscriptionCredits: existing._subscriptionCredits ?? existing.subscriptionCredits,
              purchasedCredits: existing._purchasedCredits ?? existing.purchasedCredits,
            },
            userData,
          );
          // Clear stale private cache fields when server sends fresh numbers so
          // enrichUserWithTotalCredits re-derives from the server values, not stale localStorage.
          const resetPrivates = {
            _legacyCredits: typeof safe.credits === "number" ? safe.credits : undefined,
            _subscriptionCredits: typeof safe.subscriptionCredits === "number" ? safe.subscriptionCredits : undefined,
            _purchasedCredits: typeof safe.purchasedCredits === "number" ? safe.purchasedCredits : undefined,
          };
          return {
            user: enrichUserWithTotalCredits({ ...existing, ...userData, ...safe, ...resetPrivates }),
          };
        }),

      // Refresh user credits from backend (fetches fresh data from DB)
      refreshUserCredits: async () => {
        try {
          const { authAPI } = await import("../services/api");
          const response = await authAPI.getProfile();

          if (response.success && response.user) {
            set((state) => {
              const existing = state.user;
              const raw = response.user;
              // Server always returns numbers for all three credit pools.
              // Never fall back to stale localStorage values when the server gives us real numbers.
              const safeCredits = mergeCreditFields(
                {
                  credits: existing?._legacyCredits ?? existing?.credits,
                  subscriptionCredits: existing?._subscriptionCredits ?? existing?.subscriptionCredits,
                  purchasedCredits: existing?._purchasedCredits ?? existing?.purchasedCredits,
                },
                raw,
              );
              // Reset private cache so enrichUserWithTotalCredits uses fresh values
              const resetPrivates = {
                _legacyCredits: safeCredits.credits,
                _subscriptionCredits: safeCredits.subscriptionCredits,
                _purchasedCredits: safeCredits.purchasedCredits,
              };
              const merged = {
                ...(existing || {}),
                ...raw,
                ...safeCredits,
                ...resetPrivates,
              };
              return { user: enrichUserWithTotalCredits(merged) };
            });
          }
        } catch (error) {
          console.error("❌ Failed to refresh user credits:", error);
        }
      },

      // ✅ v40 NEW: Get total credits (legacy + subscription + purchased). Always a number.
      getTotalCredits: () => {
        const state = get();
        const total = state.user?.credits ?? 0;
        return typeof total === "number" && total >= 0 ? total : 0;
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        telegramUser: state.telegramUser,
        isAuthenticated: state.isAuthenticated,
      }),
      // Persisted shape: { user, isAuthenticated }. Do not remove fields or credits can appear as 0.
      // Re-enrich on rehydration so stale localStorage data is corrected immediately
      onRehydrateStorage: () => (state) => {
        if (state?.user) {
          state.user = enrichUserWithTotalCredits(state.user);
        }
      },
    },
  ),
);

export const useGenerationStore = create((set) => ({
  generations: [],
  currentGeneration: null,
  isGenerating: false,
  queuePosition: null,

  addGeneration: (generation) =>
    set((state) => ({
      generations: [generation, ...state.generations],
    })),

  setCurrentGeneration: (generation) =>
    set({
      currentGeneration: generation,
    }),

  setGenerating: (isGenerating) => set({ isGenerating }),

  setQueuePosition: (position) => set({ queuePosition: position }),

  clearGenerations: () => set({ generations: [] }),
}));

export const useUIStore = create((set) => ({
  sidebarOpen: true,
  toggleSidebar: () =>
    set((state) => ({
      sidebarOpen: !state.sidebarOpen,
    })),

  theme: "dark",
  setTheme: (theme) => set({ theme }),
}));
