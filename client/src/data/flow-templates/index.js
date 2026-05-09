/**
 * Starter Flow Templates
 * Each template is a static JSON-serialisable flow definition
 * that can be imported into a user's flow library.
 */

export const FLOW_TEMPLATES = [
  {
    id: "template-portrait-enhancer",
    name: "Portrait Enhancer",
    description: "Upload a portrait → generate a polished avatar → upscale to max resolution.",
    thumbnail: null,
    nodes: [
      {
        id: "image-input-1",
        type: "image-input",
        position: { x: 80, y: 180 },
        data: { imageUrl: "", mode: "url", label: "Image Input" },
      },
      {
        id: "nana-banana-1",
        type: "nana-banana-avatar",
        position: { x: 360, y: 120 },
        data: { resolution: "2K", aspectRatio: "9:16", label: "Avatar Generator" },
      },
      {
        id: "upscaler-1",
        type: "upscaler",
        position: { x: 640, y: 180 },
        data: { scale: 2, label: "Upscaler" },
      },
      {
        id: "output-1",
        type: "output-viewer",
        position: { x: 920, y: 180 },
        data: { saveToHistory: true, label: "Output" },
      },
    ],
    edges: [
      { id: "e1", source: "image-input-1", sourceHandle: "image", target: "nana-banana-1", targetHandle: "image", type: "smoothstep" },
      { id: "e2", source: "nana-banana-1", sourceHandle: "image", target: "upscaler-1", targetHandle: "image", type: "smoothstep" },
      { id: "e3", source: "upscaler-1", sourceHandle: "image", target: "output-1", targetHandle: "any", type: "smoothstep" },
    ],
  },

  {
    id: "template-avatar-video-pipeline",
    name: "Avatar Video Pipeline",
    description: "Pick your model + write a prompt → generate avatar photo → animate it into a video.",
    thumbnail: null,
    nodes: [
      {
        id: "model-sel-1",
        type: "model-selector",
        position: { x: 80, y: 80 },
        data: { modelId: "", label: "Model Selector" },
      },
      {
        id: "text-input-1",
        type: "text-input",
        position: { x: 80, y: 280 },
        data: { text: "Cinematic portrait, golden hour, luxury fashion editorial", label: "Prompt" },
      },
      {
        id: "enhance-1",
        type: "enhance-prompt",
        position: { x: 340, y: 280 },
        data: { mode: "casual", label: "Enhance Prompt" },
      },
      {
        id: "nana-1",
        type: "nana-banana-avatar",
        position: { x: 600, y: 180 },
        data: { resolution: "2K", aspectRatio: "9:16", label: "Generate Avatar" },
      },
      {
        id: "video-1",
        type: "video-prompt",
        position: { x: 880, y: 180 },
        data: { duration: 5, videoModel: "kling-3.0", label: "Animate" },
      },
      {
        id: "out-1",
        type: "output-viewer",
        position: { x: 1160, y: 180 },
        data: { label: "Output" },
      },
    ],
    edges: [
      { id: "e1", source: "model-sel-1", sourceHandle: "model", target: "nana-1", targetHandle: "model", type: "smoothstep" },
      { id: "e2", source: "text-input-1", sourceHandle: "text", target: "enhance-1", targetHandle: "text", type: "smoothstep" },
      { id: "e3", source: "enhance-1", sourceHandle: "text", target: "nana-1", targetHandle: "text", type: "smoothstep" },
      { id: "e4", source: "nana-1", sourceHandle: "image", target: "video-1", targetHandle: "image", type: "smoothstep" },
      { id: "e5", source: "text-input-1", sourceHandle: "text", target: "video-1", targetHandle: "text", type: "smoothstep" },
      { id: "e6", source: "video-1", sourceHandle: "video", target: "out-1", targetHandle: "any", type: "smoothstep" },
    ],
  },

  {
    id: "template-nsfw-full-suite",
    name: "NSFW Full Suite",
    description: "Select model + enhance prompt → generate NSFW image → convert to video.",
    thumbnail: null,
    nodes: [
      {
        id: "model-sel-1",
        type: "model-selector",
        position: { x: 80, y: 80 },
        data: { modelId: "", label: "Model" },
      },
      {
        id: "text-input-1",
        type: "text-input",
        position: { x: 80, y: 280 },
        data: { text: "", label: "Prompt" },
      },
      {
        id: "enhance-1",
        type: "enhance-prompt",
        position: { x: 340, y: 280 },
        data: { label: "Enhance Prompt" },
      },
      {
        id: "nsfw-gen-1",
        type: "nsfw-gen",
        position: { x: 600, y: 180 },
        data: { quantity: 1, label: "NSFW Image" },
      },
      {
        id: "nsfw-vid-1",
        type: "nsfw-video",
        position: { x: 880, y: 180 },
        data: { duration: 5, label: "NSFW Video" },
      },
      {
        id: "out-1",
        type: "output-viewer",
        position: { x: 1160, y: 180 },
        data: { label: "Output" },
      },
    ],
    edges: [
      { id: "e1", source: "model-sel-1", sourceHandle: "model", target: "nsfw-gen-1", targetHandle: "model", type: "smoothstep" },
      { id: "e2", source: "model-sel-1", sourceHandle: "model", target: "nsfw-vid-1", targetHandle: "model", type: "smoothstep" },
      { id: "e3", source: "text-input-1", sourceHandle: "text", target: "enhance-1", targetHandle: "text", type: "smoothstep" },
      { id: "e4", source: "enhance-1", sourceHandle: "text", target: "nsfw-gen-1", targetHandle: "text", type: "smoothstep" },
      { id: "e5", source: "nsfw-gen-1", sourceHandle: "image", target: "nsfw-vid-1", targetHandle: "image", type: "smoothstep" },
      { id: "e6", source: "nsfw-vid-1", sourceHandle: "video", target: "out-1", targetHandle: "any", type: "smoothstep" },
    ],
  },

  {
    id: "template-synthid-cleaner",
    name: "SynthID Cleaner",
    description: "Remove digital watermarks from an image then upscale it.",
    thumbnail: null,
    nodes: [
      {
        id: "img-in-1",
        type: "image-input",
        position: { x: 80, y: 180 },
        data: { imageUrl: "", mode: "url", label: "Watermarked Image" },
      },
      {
        id: "synthid-1",
        type: "synthid-remover",
        position: { x: 360, y: 180 },
        data: { label: "Remove Watermark" },
      },
      {
        id: "upscaler-1",
        type: "upscaler",
        position: { x: 640, y: 180 },
        data: { scale: 2, label: "Upscale" },
      },
      {
        id: "out-1",
        type: "output-viewer",
        position: { x: 920, y: 180 },
        data: { label: "Clean Output" },
      },
    ],
    edges: [
      { id: "e1", source: "img-in-1", sourceHandle: "image", target: "synthid-1", targetHandle: "image", type: "smoothstep" },
      { id: "e2", source: "synthid-1", sourceHandle: "image", target: "upscaler-1", targetHandle: "image", type: "smoothstep" },
      { id: "e3", source: "upscaler-1", sourceHandle: "image", target: "out-1", targetHandle: "any", type: "smoothstep" },
    ],
  },

  {
    id: "template-creative-chain",
    name: "Creative Chain",
    description: "Write an idea → AI-enhance prompt → Creator Studio → face-swap onto result → output.",
    thumbnail: null,
    nodes: [
      {
        id: "text-in-1",
        type: "text-input",
        position: { x: 80, y: 180 },
        data: { text: "A model on a beach at golden hour, magazine editorial style", label: "Your Idea" },
      },
      {
        id: "enhance-1",
        type: "enhance-prompt",
        position: { x: 340, y: 180 },
        data: { label: "Enhance Prompt" },
      },
      {
        id: "creator-1",
        type: "creator-studio",
        position: { x: 600, y: 180 },
        data: { aspectRatio: "9:16", label: "Creator Studio" },
      },
      {
        id: "face-in-1",
        type: "image-input",
        position: { x: 600, y: 380 },
        data: { imageUrl: "", mode: "url", label: "Face Source" },
      },
      {
        id: "faceswap-1",
        type: "face-swap",
        position: { x: 880, y: 180 },
        data: { label: "Face Swap" },
      },
      {
        id: "out-1",
        type: "output-viewer",
        position: { x: 1160, y: 180 },
        data: { label: "Final Output" },
      },
    ],
    edges: [
      { id: "e1", source: "text-in-1", sourceHandle: "text", target: "enhance-1", targetHandle: "text", type: "smoothstep" },
      { id: "e2", source: "enhance-1", sourceHandle: "text", target: "creator-1", targetHandle: "text", type: "smoothstep" },
      { id: "e3", source: "creator-1", sourceHandle: "image", target: "faceswap-1", targetHandle: "image", type: "smoothstep" },
      { id: "e4", source: "face-in-1", sourceHandle: "image", target: "faceswap-1", targetHandle: "face", type: "smoothstep" },
      { id: "e5", source: "faceswap-1", sourceHandle: "image", target: "out-1", targetHandle: "any", type: "smoothstep" },
    ],
  },

  {
    id: "template-talking-avatar",
    name: "Talking Avatar",
    description: "Generate an avatar → record script → synthesize your model's voice → lip-sync into a talking-head video.",
    thumbnail: null,
    nodes: [
      {
        id: "model-sel-1",
        type: "model-selector",
        position: { x: 60, y: 120 },
        data: { modelId: "", label: "Model" },
      },
      {
        id: "text-prompt-1",
        type: "text-input",
        position: { x: 60, y: 320 },
        data: { text: "Close-up cinematic portrait, soft window light, 35mm film", label: "Image Prompt" },
      },
      {
        id: "nana-1",
        type: "nana-banana-avatar",
        position: { x: 340, y: 180 },
        data: { resolution: "2K", aspectRatio: "9:16", label: "Generate Avatar" },
      },
      {
        id: "script-1",
        type: "text-input",
        position: { x: 60, y: 520 },
        data: { text: "Hey! Today I want to show you something special…", label: "Script" },
      },
      {
        id: "voice-1",
        type: "voice-gen",
        position: { x: 340, y: 440 },
        data: { stability: 0.5, similarityBoost: 0.8, style: 0.1, label: "My Voice" },
      },
      {
        id: "talking-1",
        type: "talking-head",
        position: { x: 640, y: 280 },
        data: { label: "Lip-Sync Video" },
      },
      {
        id: "out-1",
        type: "output-viewer",
        position: { x: 940, y: 280 },
        data: { label: "Final Video" },
      },
    ],
    edges: [
      { id: "e1", source: "model-sel-1", sourceHandle: "model", target: "nana-1", targetHandle: "model", type: "default" },
      { id: "e2", source: "text-prompt-1", sourceHandle: "text", target: "nana-1", targetHandle: "text", type: "default" },
      { id: "e3", source: "model-sel-1", sourceHandle: "model", target: "voice-1", targetHandle: "model", type: "default" },
      { id: "e4", source: "script-1", sourceHandle: "text", target: "voice-1", targetHandle: "text", type: "default" },
      { id: "e5", source: "nana-1", sourceHandle: "image", target: "talking-1", targetHandle: "image", type: "default" },
      { id: "e6", source: "voice-1", sourceHandle: "audio", target: "talking-1", targetHandle: "audio", type: "default" },
      { id: "e7", source: "talking-1", sourceHandle: "video", target: "out-1", targetHandle: "any", type: "default" },
    ],
  },
];

export default FLOW_TEMPLATES;
