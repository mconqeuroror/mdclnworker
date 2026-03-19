/** Keep ids in sync with server `src/utils/nsfwResolution.js` NSFW_RESOLUTION_MAP */

export const NSFW_RESOLUTION_OPTIONS = [
  { id: "1344x768", label: "Landscape 16:9", size: "1344×768", hint: "Default" },
  { id: "768x1344", label: "Portrait 9:16", size: "768×1344", hint: "Vertical / phone" },
  { id: "1024x1024", label: "Square HD", size: "1024×1024", hint: "1:1" },
  { id: "1152x896", label: "Landscape 4:3", size: "1152×896", hint: "4:3" },
  { id: "896x1152", label: "Portrait 3:4", size: "896×1152", hint: "3:4" },
  { id: "1216x832", label: "Landscape 3:2", size: "1216×832", hint: "3:2" },
  { id: "832x1216", label: "Portrait 5:8", size: "832×1216", hint: "5:8" },
  { id: "1536x640", label: "Ultrawide 21:9", size: "1536×640", hint: "21:9" },
  { id: "640x1536", label: "Tall 9:21", size: "640×1536", hint: "9:21" },
];
