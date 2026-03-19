/**
 * ComfyUI "CR SDXL Aspect Ratio" (node 50) — only presets supported by RunPod ComfyUI.
 * Values must match the node's input_config list exactly.
 */
export const NSFW_RESOLUTION_MAP = {
  "1344x768": { width: 1344, height: 768, aspect_ratio: "16:9 landscape 1344x768" },
  "768x1344": { width: 768, height: 1344, aspect_ratio: "9:16 portrait 768x1344" },
  "1024x1024": { width: 1024, height: 1024, aspect_ratio: "1:1 square 1024x1024" },
  "1152x896": { width: 1152, height: 896, aspect_ratio: "4:3 landscape 1152x896" },
  "896x1152": { width: 896, height: 1152, aspect_ratio: "3:4 portrait 896x1152" },
  "1216x832": { width: 1216, height: 832, aspect_ratio: "3:2 landscape 1216x832" },
  "832x1216": { width: 832, height: 1216, aspect_ratio: "5:8 portrait 832x1216" },
  "1536x640": { width: 1536, height: 640, aspect_ratio: "21:9 landscape 1536x640" },
  "640x1536": { width: 640, height: 1536, aspect_ratio: "9:21 portrait 640x1536" },
};

const DEFAULT_KEY = "1344x768";

/**
 * @param {string | undefined} presetId - e.g. "1344x768"
 * @returns {{ width: number, height: number, aspect_ratio: string, presetId: string }}
 */
export function resolveNsfwResolution(presetId) {
  const key = presetId && NSFW_RESOLUTION_MAP[presetId] ? presetId : DEFAULT_KEY;
  const spec = NSFW_RESOLUTION_MAP[key];
  return { ...spec, presetId: key };
}
