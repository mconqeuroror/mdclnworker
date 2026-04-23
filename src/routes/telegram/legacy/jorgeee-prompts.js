/**
 * Jorgeee “quick copy” prompts → paste into Mini App → Generate → Advanced.
 * Key `i` = multi-reference identity recreate (1 / 2 / 3 source images).
 */
export const JORGEEE_QUICK_PROMPTS = {
  i: [
    "recreate image 2 using identity from image 1. keep clothes, pose, hand placement, face expression, eye trajectory, mood, lighting, angle of the shot and background from image 2. don't keep clothes or accessories from image 1.",
    "recreate image 3 using identity from images 1 and 2. keep clothes, pose, hand placement, face expression, eye trajectory, mood, lighting, angle of the shot and background from image 3. don't keep clothes or accessories from images 1 and 2.",
    "recreate image 4 using identity from images 1,2 and 3. keep pose, hand placement, face expression, mood, lighting and angle of the shot from image 4. keep clothes and background from image 5. don't keep clothes or accessories from images 1,2,3 and 4.",
  ],
};

const QUICK_LABELS = ["1 photo", "2 photos", "3 photos"];

export function getJorgeeeQuickPrompt(engineKey, index) {
  const list = JORGEEE_QUICK_PROMPTS[engineKey];
  if (!Array.isArray(list) || index < 0 || index >= list.length) return null;
  return list[index];
}

export function getJorgeeeQuickPromptTitle(engineKey, index) {
  if (engineKey === "i" && index >= 0 && index < QUICK_LABELS.length) {
    return `📋 ${QUICK_LABELS[index]}`;
  }
  return `📋 Quick #${index + 1}`;
}

/** Inline rows — callback_data ≤ 64 bytes. */
export function jorgeeeQuickPromptButtonRows() {
  return [
    [
      { text: "📋 1 photo", callback_data: "jorgeee:qp:i:0" },
      { text: "📋 2 photos", callback_data: "jorgeee:qp:i:1" },
    ],
    [{ text: "📋 3 photos", callback_data: "jorgeee:qp:i:2" }],
  ];
}
