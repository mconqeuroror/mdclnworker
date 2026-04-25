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
 * - Polls every 5s when page is visible
 * - Detects completions and shows toast notifications
 * 
 * @param {string} type - Generation type filter: 'image' | 'video' | 'talking-head' | 'all'
 * @returns {object} Generation data and helpers
 */

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
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 10000, // 10s - prevents refetch on tab switch
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
