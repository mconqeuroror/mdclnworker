import { isR2Configured } from "../utils/r2.js";
import { isVercelBlobConfigured, uploadBufferToBlobOrR2 } from "../utils/kieUpload.js";

function getElevenLabsApiKey() {
  return (
    process.env.ELEVENLABS_API_KEY ||
    process.env.ELEVEN_API_KEY ||
    process.env.ELEVENLABS_KEY ||
    ""
  );
}

const ELEVENLABS_API_KEY = getElevenLabsApiKey();
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

/** Text-to-voice /design accepts only TTV models (not TTS ids like eleven_v3). */
const ELEVEN_TTV_DESIGN_MODEL_ID = "eleven_ttv_v3";

if (!ELEVENLABS_API_KEY) {
  console.warn("⚠️ ELEVENLABS_API_KEY not set - talking head feature will be disabled");
}

/**
 * Get list of available voices from ElevenLabs
 * Only fetches female voices from user's account (not shared library)
 * @returns {Promise<Array>} Array of voice objects with id, name, labels, language
 */
export async function getVoices() {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("Voice service not configured");
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voice service error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  // Curated list of voice IDs with generated previews
  const curatedVoiceIds = [
    "vz3dx89akMq5gofrv9Bi", // Bianca Bodine - Sweet and Charming
    "BpjGufoPiobT79j2vtj4", // Priyanka - Calm, Neutral and Relaxed
    "2t85BBUECtLLKQzxLD95", // Amber - Calm, Elegant and Dreamy
    "6fZce9LFNG3iEITDfqZZ", // Charlotte - Warm, Clear, Modern
    "kdmDKE6EkgrWrrykO9Qt", // Alexandra - Conversational and Natural
    "FGY2WhTYpPnrIDTdsKH5", // Laura - Enthusiast, Quirky
    "Xb7hH8MSUJpSbSDYk0k2", // Alice - Clear, Engaging Educator
    "XrExE9yKIg1WjnnlVkGX", // Matilda - Professional
    "cgSgspJ2msm6clMCkdW9", // Jessica - Playful, Bright, Warm
    "pFZP5JQG7iQjIQuC4Bku", // Lily - Velvety Actress
    "Hh0rE70WfnSFN80K8uJC", // Hannah - Neutral, Polished
    "WAhoMTNdLdMoq1j3wf3I", // Hope - Smooth talker
    "tnSpp4vdxKPjI9w0GnoV", // Hope - upbeat and clear
    "yj30vwTGJxSHezdAGsv9", // Jessa - Authentic, friendly
    "OYTbf65OHHFELVut7v2H", // Hope - Natural, Clear and Calm
  ];

  const femaleVoices = data.voices
    .filter(v => curatedVoiceIds.includes(v.voice_id))
    .sort((a, b) => curatedVoiceIds.indexOf(a.voice_id) - curatedVoiceIds.indexOf(b.voice_id))
    .map(voice => ({
      id: voice.voice_id,
      name: voice.name,
      category: voice.category || "premade",
      labels: voice.labels || {},
      languages: ["en", "sk", "cs"], // All voices support EN, SK, CS
      originalPreviewUrl: voice.preview_url, // Original ElevenLabs preview (English only)
      previewUrls: {
        en: `${process.env.R2_PUBLIC_URL}/voice-previews/${voice.voice_id}_en.mp3`,
        sk: `${process.env.R2_PUBLIC_URL}/voice-previews/${voice.voice_id}_sk.mp3`,
        cs: `${process.env.R2_PUBLIC_URL}/voice-previews/${voice.voice_id}_cs.mp3`,
      },
    }));

  console.log(`📢 Loaded ${femaleVoices.length} curated female voices`);
  
  return femaleVoices;
}

/**
 * List all voices in the current ElevenLabs account.
 * Returns raw account voices (not curated app list).
 */
export async function listElevenLabsAccountVoices() {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error("Voice service not configured");
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      "xi-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voice service error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return Array.isArray(data?.voices) ? data.voices : [];
}

/**
 * Infer age category from voice name/description
 */
function inferAgeFromName(name) {
  const nameLower = (name || "").toLowerCase();
  
  // Young indicators
  if (nameLower.includes("young") || nameLower.includes("teen") || 
      nameLower.includes("girl") || nameLower.includes("child") ||
      nameLower.includes("youthful") || nameLower.includes("fresh")) {
    return "young";
  }
  
  // Mature indicators  
  if (nameLower.includes("mature") || nameLower.includes("elder") ||
      nameLower.includes("senior") || nameLower.includes("wise") ||
      nameLower.includes("grandma") || nameLower.includes("granny")) {
    return "middle_aged";
  }
  
  // Default - most library voices are young/adult
  return "young";
}

/**
 * Generate speech audio from text using ElevenLabs
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - ElevenLabs voice ID
 * @param {object} options - Voice settings
 * @returns {Promise<Buffer>} Audio buffer (MP3)
 */
export async function textToSpeech(text, voiceId, options = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error("Voice service not configured");
  }

  console.log("\n🎙️ ============================================");
  console.log("🎙️ ELEVENLABS TEXT-TO-SPEECH");
  console.log("🎙️ ============================================");
  console.log(`🗣️ Voice ID: ${voiceId}`);
  console.log(`📝 Text length: ${text.length} characters`);
  console.log("⏳ Generating audio...\n");

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: text,
      model_id: options.modelId || options.model_id || "eleven_v3",
      voice_settings: {
        stability: options.stability || 0.5,
        similarity_boost: options.similarityBoost || 0.75,
        style: options.style || 0.0,
        use_speaker_boost: options.speakerBoost !== false,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("❌ ElevenLabs TTS error:", error);
    throw new Error(`Voice service error: ${response.status} - ${error}`);
  }

  const audioBuffer = await response.arrayBuffer();
  console.log(`✅ Audio generated: ${audioBuffer.byteLength} bytes`);
  
  return Buffer.from(audioBuffer);
}

/**
 * Upload talking-head audio to R2 hosting
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} publicId - Optional compatibility arg (unused)
 * @returns {Promise<{url: string, duration: number}>} URL and duration in seconds
 */
export async function uploadAudioToR2(audioBuffer, publicId = null) {
  void publicId;
  if (!isVercelBlobConfigured() && !isR2Configured()) {
    throw new Error("Audio hosting is not configured (Blob or R2 required).");
  }

  const r2Url = await uploadBufferToBlobOrR2(
    audioBuffer,
    "talking-head-audio",
    "mp3",
    "audio/mpeg",
  );
  console.log(`✅ Audio uploaded: ${r2Url}`);
  return { url: r2Url, duration: 0 };
}

/**
 * Voice speed profiles (seconds per character)
 * Measured from actual ElevenLabs audio samples
 * Higher value = slower speech = more expensive
 * 
 * Formula: audio_duration / text_length = seconds_per_char
 * Example: 7s audio / 100 chars = 0.07 s/char
 */
const VOICE_SPEED_PROFILES = {
  // Curated voices - measured average speeds
  "vz3dx89akMq5gofrv9Bi": 0.065, // Bianca - faster, energetic
  "BpjGufoPiobT79j2vtj4": 0.070, // Priyanka - calm, moderate
  "2t85BBUECtLLKQzxLD95": 0.075, // Amber - calm, elegant, slower
  "6fZce9LFNG3iEITDfqZZ": 0.068, // Charlotte - warm, moderate
  "kdmDKE6EkgrWrrykO9Qt": 0.065, // Alexandra - conversational, faster
  "FGY2WhTYpPnrIDTdsKH5": 0.070, // Laura - enthusiastic
  "Xb7hH8MSUJpSbSDYk0k2": 0.072, // Alice - clear educator
  "XrExE9yKIg1WjnnlVkGX": 0.070, // Matilda - professional
  "cgSgspJ2msm6clMCkdW9": 0.068, // Jessica - playful, bright
  "pFZP5JQG7iQjIQuC4Bku": 0.075, // Lily - velvety, slower
  "Hh0rE70WfnSFN80K8uJC": 0.070, // Hannah - neutral, polished
  "WAhoMTNdLdMoq1j3wf3I": 0.072, // Hope - smooth talker
  "tnSpp4vdxKPjI9w0GnoV": 0.065, // Hope upbeat - faster
  "yj30vwTGJxSHezdAGsv9": 0.068, // Jessa - authentic
  "OYTbf65OHHFELVut7v2H": 0.072, // Hope natural - calm, slower
};

// Default for unknown voices (conservative - assumes slower speech)
const DEFAULT_SECONDS_PER_CHAR = 0.075;

/**
 * Get estimated audio duration based on text length and voice
 * Uses per-voice speed profiles for accurate estimates
 * @param {string} text - Text content
 * @param {string} voiceId - ElevenLabs voice ID
 * @returns {number} Estimated duration in seconds
 */
export function estimateAudioDuration(text, voiceId = null) {
  const secondsPerChar = voiceId && VOICE_SPEED_PROFILES[voiceId] 
    ? VOICE_SPEED_PROFILES[voiceId] 
    : DEFAULT_SECONDS_PER_CHAR;
  
  const duration = text.length * secondsPerChar;
  
  // WaveSpeed minimum is 5 seconds
  return Math.max(5, Math.ceil(duration));
}

/**
 * Sample preview phrases for each language
 */
const PREVIEW_PHRASES = {
  en: "Hey this is how I sound, I hope you will pick me.",
  sk: "Ahoj! Takto znie môj hlas. Dúfam, že sa ti páči.",
  cs: "Ahoj! Takto zní můj hlas. Doufám, že se ti líbí.",
};

// In-memory cache for preview URLs (persists during server runtime)
const previewCache = new Map();

/**
 * Generate a voice preview in the specified language with caching
 * First request generates and caches to R2, subsequent requests serve from cache
 * @param {string} voiceId - ElevenLabs voice ID
 * @param {string} language - Language code (en, sk, cs)
 * @returns {Promise<{buffer?: Buffer, cachedUrl?: string}>} Audio buffer or cached URL
 */
export async function generateVoicePreview(voiceId, language = "en") {
  const cacheKey = `${voiceId}_${language}`;
  
  // Check in-memory cache first
  if (previewCache.has(cacheKey)) {
    console.log(`🔊 Preview cache hit: ${cacheKey}`);
    return { cachedUrl: previewCache.get(cacheKey) };
  }

  console.log(`🔊 Preview cache miss - generating: ${cacheKey}`);
  
  const phrase = PREVIEW_PHRASES[language] || PREVIEW_PHRASES.en;
  const audioBuffer = await textToSpeech(phrase, voiceId, {
    stability: 0.5,
    similarityBoost: 0.75,
  });

  // Upload to R2 for permanent caching
  try {
    const { uploadToR2 } = await import("../utils/r2.js");
    const r2Url = await uploadToR2(audioBuffer, `voice-previews/${cacheKey}.mp3`, "audio/mpeg");
    previewCache.set(cacheKey, r2Url);
    console.log(`✅ Preview cached to R2: ${r2Url}`);
    return { buffer: audioBuffer, cachedUrl: r2Url };
  } catch (err) {
    console.error("Failed to cache preview to R2:", err.message);
    // Return buffer anyway even if caching failed
    return { buffer: audioBuffer };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom voices: Voice Design + IVC (instant voice clone) + delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Design voice previews from a text description (no permanent voice yet).
 * @returns {Promise<Array<{ generatedVoiceId: string, audioBase64: string }>>}
 */
export async function designVoicePreviews(voiceDescription, options = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) throw new Error("Voice service not configured");

  const body = {
    voice_description: voiceDescription,
    auto_generate_text: options.autoGenerateText !== false,
    model_id: options.modelId || options.model_id || ELEVEN_TTV_DESIGN_MODEL_ID,
  };

  const response = await fetch(`${ELEVENLABS_API_URL}/text-to-voice/design`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Voice design failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const raw =
    data.previews ||
    data.voice_previews ||
    data.data?.previews ||
    (Array.isArray(data) ? data : []);

  const previews = [];
  for (const p of raw) {
    const generatedVoiceId =
      p.generated_voice_id || p.generatedVoiceId || p.voice_id;
    const audioBase64 =
      p.audio_base_64 || p.audio_base64 || p.audio || p.sample;
    if (generatedVoiceId && audioBase64) {
      previews.push({ generatedVoiceId, audioBase64 });
    }
  }

  return previews;
}

/**
 * Create a saved voice from a design preview id.
 * @returns {Promise<{ voiceId: string }>}
 */
export async function createVoiceFromDesignPreview({
  voiceName,
  voiceDescription,
  generatedVoiceId,
}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) throw new Error("Voice service not configured");

  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-voice/create-voice-from-preview`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voice_name: voiceName,
        voice_description: voiceDescription || voiceName,
        generated_voice_id: generatedVoiceId,
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Create voice from preview failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const voiceId = data.voice_id || data.voiceId;
  if (!voiceId) {
    throw new Error("ElevenLabs did not return voice_id");
  }
  return { voiceId };
}

/**
 * Instant voice clone from one MP3 sample (multipart).
 * @returns {Promise<{ voiceId: string, requiresVerification?: boolean }>}
 */
export async function cloneVoiceFromMp3Buffer({
  voiceName,
  description,
  mp3Buffer,
  filename = "sample.mp3",
  labels = null,
}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) throw new Error("Voice service not configured");

  const blob = new Blob([mp3Buffer], { type: "audio/mpeg" });
  const form = new FormData();
  form.append("name", voiceName);
  if (description) form.append("description", description);
  if (labels && typeof labels === "object" && Object.keys(labels).length > 0) {
    form.append("labels", JSON.stringify(labels));
  }
  form.append("files", blob, filename.replace(/[^\w.-]/g, "_") || "sample.mp3");

  const response = await fetch(`${ELEVENLABS_API_URL}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Voice clone failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const voiceId = data.voice_id || data.voiceId;
  if (!voiceId) {
    throw new Error("ElevenLabs did not return voice_id");
  }
  return {
    voiceId,
    requiresVerification: Boolean(data.requires_verification),
  };
}

/**
 * Fetch voice metadata (includes preview_url when available).
 */
export async function getElevenLabsVoice(voiceId) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) throw new Error("Voice service not configured");

  const response = await fetch(`${ELEVENLABS_API_URL}/voices/${encodeURIComponent(voiceId)}`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Get voice failed: ${response.status} - ${errText}`);
  }

  return response.json();
}

/**
 * Delete a voice from the ElevenLabs account (best-effort; 404 = ok).
 */
export async function deleteElevenLabsVoice(voiceId) {
  if (!voiceId) return;
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    console.warn("deleteElevenLabsVoice: no API key, skipping");
    return;
  }

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/voices/${encodeURIComponent(voiceId)}`,
      {
        method: "DELETE",
        headers: { "xi-api-key": apiKey },
      },
    );
    if (response.status === 404) {
      console.log(`🗑️ ElevenLabs voice already gone: ${voiceId}`);
      return;
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error(`🗑️ ElevenLabs delete voice ${voiceId}: ${response.status} ${errText}`);
      return;
    }
    console.log(`🗑️ Deleted ElevenLabs voice: ${voiceId}`);
  } catch (err) {
    console.error(`🗑️ ElevenLabs delete voice error (${voiceId}):`, err.message);
  }
}

/**
 * Delete voice on ElevenLabs; throws if API fails (except 404). Use before recreating a model voice.
 */
export async function deleteElevenLabsVoiceStrict(voiceId) {
  if (!voiceId) return;
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) throw new Error("Voice service not configured");

  const response = await fetch(
    `${ELEVENLABS_API_URL}/voices/${encodeURIComponent(voiceId)}`,
    {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
    },
  );

  if (response.status === 404) return;
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Could not remove previous saved model voice (${response.status}): ${errText}`);
  }
}
