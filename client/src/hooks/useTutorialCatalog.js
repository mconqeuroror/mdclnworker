import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { tutorialsAPI } from "../services/api";

function sanitizeTutorialByKey(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const url = typeof v.url === "string" ? v.url.trim() : "";
    let label = v.label;
    if (label != null && typeof label !== "string") label = null;
    out[k] = { ...v, url, label: label ?? k };
  }
  return out;
}

export function useTutorialCatalog() {
  const query = useQuery({
    queryKey: ["tutorial-catalog"],
    queryFn: async () => {
      const data = await tutorialsAPI.getCatalog();
      return sanitizeTutorialByKey(data?.byKey);
    },
    staleTime: 60_000,
  });

  const byKey = query.data || {};

  const getTutorial = useMemo(
    () => (slotKey, fallbackTitle = "Tutorial") => {
      const item = byKey?.[slotKey];
      if (!item?.exists || !item?.url) return null;
      const title =
        typeof item.label === "string" && item.label.trim()
          ? item.label
          : String(fallbackTitle ?? "Tutorial");
      return { title, videoUrl: item.url };
    },
    [byKey],
  );

  return {
    ...query,
    byKey,
    getTutorial,
  };
}
