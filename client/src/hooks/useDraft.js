import { useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { uploadFile } from "../services/api";

export function useDraft(feature, { debounceMs = 2000 } = {}) {
  const queryClient = useQueryClient();
  const timerRef = useRef(null);
  const latestRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["draft", feature],
    queryFn: async () => {
      const res = await api.get(`/drafts/${feature}`);
      return res.data.draft || null;
    },
    staleTime: 60000,
    retry: false,
  });

  const saveDraft = useCallback(
    (draftData, imageUrls) => {
      latestRef.current = { data: draftData, imageUrls: imageUrls || [] };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        try {
          const payload = latestRef.current;
          if (!payload) return;
          await api.put(`/drafts/${feature}`, payload);
          queryClient.setQueryData(["draft", feature], {
            data: payload.data,
            imageUrls: payload.imageUrls,
          });
        } catch (e) {
          console.warn("Draft save failed:", e.message);
        }
      }, debounceMs);
    },
    [feature, debounceMs, queryClient],
  );

  const saveDraftNow = useCallback(
    async (draftData, imageUrls) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        const payload = { data: draftData, imageUrls: imageUrls || [] };
        await api.put(`/drafts/${feature}`, payload);
        queryClient.setQueryData(["draft", feature], {
          data: payload.data,
          imageUrls: payload.imageUrls,
        });
      } catch (e) {
        console.warn("Draft save failed:", e.message);
      }
    },
    [feature, queryClient],
  );

  const clearDraft = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await api.delete(`/drafts/${feature}`);
    } catch (e) {
      console.warn("Draft clear failed:", e.message);
    }
    queryClient.setQueryData(["draft", feature], null);
    queryClient.invalidateQueries({ queryKey: ["draft", feature] });
  }, [feature, queryClient]);

  const uploadDraftImage = useCallback(async (file) => {
    return uploadFile(file);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    draft: data || null,
    isLoading,
    saveDraft,
    saveDraftNow,
    clearDraft,
    uploadDraftImage,
  };
}
