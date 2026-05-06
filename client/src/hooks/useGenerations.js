import { useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "./usePageVisibility";
import api from "../services/api";

/**
 * UNIFIED generation hook - single source of truth for all generation data
 *
 * Architecture:
 * - React Query cache is the ONLY source of truth
 * - No localStorage, no custom events, no local state
 * - Adaptive polling cadence:
 *     • 2 s  while a generation is processing (so finishes appear ASAP)
 *     • 30 s while everything is idle (saves DB pressure at scale)
 *     • paused entirely when the tab is hidden
 * - Detects completions and surfaces them to the rest of the UI
 *
 * @param {string} type - Generation type filter: 'image' | 'video' | 'talking-head' | 'all'
 * @returns {object} Generation data and helpers
 */
const ACTIVE_POLL_MS = 2000;   // tight loop while a job is running
const IDLE_POLL_MS = 30000;    // slow heartbeat when nothing is processing

// Groups for LivePreviewPanel - shows all related types together
const TYPE_GROUPS = {
  "all-images": ["image", "image-identity", "prompt-image", "face-swap-image", "advanced-image"],
  "all-videos": [
    "video",
    "prompt-video",
    "face-swap",
    "recreate-video",
    "talking-head",
    "nsfw-video-motion",
  ],
  /** Recreate / motion outputs from Create (video + legacy types + RunPod motion) */
  "recreate-videos": ["video", "recreate-video", "nsfw-video-motion"],
  "all-nsfw": ["nsfw", "nsfw-video", "nsfw-video-extend"],
  all: null,
};

export function useGenerations(type = "all") {
  const isPageVisible = usePageVisibility();
  const queryClient = useQueryClient();
  const seenCompletedIds = useRef(new Set());
  const initialLoadDone = useRef(false);

  // Use TYPE_GROUPS only for explicit group names, otherwise filter by exact type
  const typesToMatch = TYPE_GROUPS[type] || [type];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/generations"],
    queryFn: async () => {
      const response = await api.get("/generations");
      return response.data;
    },
    // Adaptive interval: tight while processing, slow while idle.
    // React Query passes the latest `query` to this callback so we can
    // inspect the cached data without holding it in component state.
    refetchInterval: (query) => {
      if (!isPageVisible) return false;
      const list = Array.isArray(query?.state?.data?.generations)
        ? query.state.data.generations
        : [];
      const hasProcessing = list.some(
        (g) => g.status === "processing" || g.status === "pending",
      );
      return hasProcessing ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    // Drop staleTime so a manual refetch (after submitting a new job) hits
    // the network instead of returning a cached "no processing" snapshot.
    staleTime: 0,
  });

  // Force refetch when page becomes visible
  useEffect(() => {
    if (isPageVisible) {
      refetch();
    }
  }, [isPageVisible, refetch]);

  const allGenerations = Array.isArray(data?.generations) ? data.generations : [];

  const filteredGenerations = type === "all" 
    ? allGenerations 
    : allGenerations.filter((gen) => typesToMatch.includes(gen.type));

  const processing = filteredGenerations.filter(
    (gen) => gen.status === "processing" || gen.status === "pending"
  );

  const completed = filteredGenerations.filter(
    (gen) => gen.status === "completed"
  );

  const failed = filteredGenerations.filter(
    (gen) => gen.status === "failed"
  );

  const latest = filteredGenerations[0] || null;

  const latestCompleted = completed[0] || null;
  
  // SIMPLIFIED: isGenerating only checks the LATEST generation's status
  // This prevents old stuck generations from blocking new ones
  const latestIsProcessing = latest?.status === 'processing' || latest?.status === 'pending';

  useEffect(() => {
    // Wait for initial load to complete before tracking completions
    if (isLoading) return;
    
    // On first data load, mark all existing completed as "seen" (no toast)
    if (!initialLoadDone.current) {
      completed.forEach((gen) => seenCompletedIds.current.add(gen.id));
      initialLoadDone.current = true;
      return;
    }

    // Mark newly completed as seen (no toast - user can see in Live Preview)
    const newlyCompleted = completed.filter(
      (gen) => !seenCompletedIds.current.has(gen.id)
    );

    if (newlyCompleted.length > 0) {
      newlyCompleted.forEach((gen) => seenCompletedIds.current.add(gen.id));
    }
  }, [completed, isLoading]);

  const triggerRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const addOptimisticGeneration = useCallback((generation) => {
    queryClient.setQueryData(["/api/generations"], (oldData) => {
      if (!oldData) return { generations: [generation] };
      const prev = Array.isArray(oldData.generations) ? oldData.generations : [];
      // CRITICAL FIX: Remove any existing generation with same ID to prevent duplicates
      const existingGenerations = prev.filter(g => g.id !== generation.id);
      
      return {
        ...oldData,
        generations: [generation, ...existingGenerations],
      };
    });
  }, [queryClient]);

  return {
    all: filteredGenerations,
    processing,
    completed,
    failed,
    latest,
    latestCompleted,
    isLoading,
    isError,
    error,
    isGenerating: latestIsProcessing,  // Only checks LATEST, not all old stuck ones
    triggerRefresh,
    addOptimisticGeneration,
  };
}
