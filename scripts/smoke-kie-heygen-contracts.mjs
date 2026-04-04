import assert from "node:assert/strict";

process.env.KIE_API_KEY = process.env.KIE_API_KEY || "smoke-kie-key";
process.env.HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || "smoke-heygen-key";
process.env.CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || "https://example.com";

const requests = [];
let taskSeq = 0;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseQuery(url) {
  try {
    return new URL(url).searchParams;
  } catch {
    return new URL(`https://dummy${url}`).searchParams;
  }
}

global.fetch = async (url, init = {}) => {
  const normalizedUrl = String(url);
  const method = String(init.method || "GET").toUpperCase();
  const bodyText =
    typeof init.body === "string"
      ? init.body
      : Buffer.isBuffer(init.body)
        ? init.body.toString("utf8")
        : null;
  requests.push({
    url: normalizedUrl,
    method,
    headers: init.headers || {},
    bodyText,
    body: init.body,
  });

  if (normalizedUrl.includes("/api/v1/playground/createAsset") && method === "POST") {
    return jsonResponse({ id: "task_asset_001" });
  }
  if (normalizedUrl.includes("/api/v1/jobs/createTask") && method === "POST") {
    taskSeq += 1;
    return jsonResponse({ code: 200, msg: "success", data: { taskId: `task_${taskSeq}` } });
  }
  if (normalizedUrl.includes("/api/v1/jobs/recordInfo")) {
    const taskId = parseQuery(normalizedUrl).get("taskId");
    if (taskId === "task_asset_001") {
      return jsonResponse({
        code: 200,
        msg: "success",
        data: {
          taskId,
          state: "success",
          resultJson: {
            assetId: "asset-abc-123",
            url: "https://example.com/asset-result.png",
          },
        },
      });
    }
    return jsonResponse({
      code: 200,
      msg: "success",
      data: {
        taskId,
        state: "success",
        resultJson: {
          output: { video_url: "https://example.com/video.mp4", image_url: "https://example.com/image.png" },
        },
      },
    });
  }

  if (normalizedUrl.includes("upload.heygen.com/v1/asset") && method === "POST") {
    return jsonResponse({
      code: 100,
      data: {
        id: "heygen-asset-id",
        url: "https://resource2.heygen.ai/image/fake/original",
        image_key: "image/fake/original",
      },
      msg: null,
      message: null,
    });
  }
  if (normalizedUrl.includes("/v2/photo_avatar/avatar_group/create") && method === "POST") {
    return jsonResponse({ error: null, data: { group_id: "group-1", id: "group-1" } });
  }
  if (normalizedUrl.includes("/v2/photo_avatar/avatar_group/add") && method === "POST") {
    return jsonResponse({ error: null, data: { generation_id: "gen-1" } });
  }
  if (normalizedUrl.includes("/v2/photo_avatar/train") && method === "POST") {
    return jsonResponse({ error: null, data: { code: 100 } });
  }
  if (normalizedUrl.includes("/v2/photo_avatar/generation/") && method === "GET") {
    return jsonResponse({
      error: null,
      data: {
        id: "gen-1",
        status: "success",
        image_key_list: ["image/fake/original"],
      },
    });
  }
  if (normalizedUrl.includes("/v2/video/generate") && method === "POST") {
    return jsonResponse({ error: null, data: { video_id: "video-1" } });
  }
  if (normalizedUrl.includes("/v2/videos/") && method === "GET") {
    return jsonResponse({
      data: { status: "completed", video_url: "https://resource2.heygen.ai/video.mp4", duration: 6.2 },
    });
  }
  if (normalizedUrl.includes("/v1/video_status.get") && method === "GET") {
    return jsonResponse({
      data: { status: "completed", video_url: "https://resource2.heygen.ai/video.mp4", duration: 6.2 },
    });
  }

  return jsonResponse({ code: 404, msg: `Unhandled mock route: ${normalizedUrl}` }, 404);
};

const {
  createVolcanicAssetKie,
  generateFluxKontextKie,
  generateWan27ImageProKie,
  generateIdeogramV3Kie,
  generateSeedance2Kie,
} = await import("../src/services/kie.service.js");

const {
  uploadAsset,
  createPhotoAvatarGroup,
  addLookToAvatarGroup,
  trainPhotoAvatarGroup,
  getPhotoAvatarStatus,
  generateAvatarVideo,
  getVideoStatus,
} = await import("../src/services/heygen.service.js");

function requireRequest(match, label) {
  const req = requests.find(match);
  assert.ok(req, `${label} request missing`);
  return req;
}

function parseJsonBody(req) {
  assert.ok(typeof req.bodyText === "string", `Request body is not JSON string for ${req.url}`);
  return JSON.parse(req.bodyText);
}

async function run() {
  const results = [];
  const check = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  };

  await createVolcanicAssetKie({ url: "https://example.com/in.jpg", assetType: "Image" });
  await generateFluxKontextKie({
    model: "flux-kontext-pro",
    prompt: "test prompt",
    inputImage: "https://example.com/input.jpg",
    aspectRatio: "16:9",
    outputFormat: "jpeg",
    promptUpsampling: true,
    safetyTolerance: 2,
  });
  await generateWan27ImageProKie({
    prompt: "wan test",
    inputUrls: ["https://example.com/a.jpg"],
    n: 2,
    resolution: "2K",
    thinkingMode: false,
    colorPalette: ["#FF0000", "#00FF00"],
    bboxList: [[10, 10, 100, 100]],
  });
  await generateIdeogramV3Kie({
    variant: "remix",
    prompt: "remix test",
    imageUrl: "https://example.com/base.jpg",
    numImages: 4,
    renderingSpeed: "BALANCED",
  });
  await generateSeedance2Kie({
    variant: "seedance-2-fast-preview",
    prompt: "seedance test",
    referenceImageUrls: Array.from({ length: 12 }).map((_, i) => `https://example.com/img-${i}.jpg`),
    duration: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    generateAudio: true,
  });

  await uploadAsset(Buffer.from("fake-image-data"), "photo.jpg", "image/jpeg", "photo_avatar");
  await createPhotoAvatarGroup("image/fake/original", "Avatar");
  await addLookToAvatarGroup("group-1", ["image/fake/original"]);
  await trainPhotoAvatarGroup("group-1");
  await getPhotoAvatarStatus("gen-1");
  await generateAvatarVideo({
    avatarId: "avatar-1",
    inputText: "Hello from smoke test",
    heygenVoiceId: "voice-1",
    callbackId: "video-local-id",
  });
  await getVideoStatus("video-1");

  check("KIE createAsset endpoint/body", () => {
    const req = requireRequest((r) => r.url.includes("/api/v1/playground/createAsset"), "createAsset");
    const body = parseJsonBody(req);
    assert.equal(body.url, "https://example.com/in.jpg");
    assert.equal(body.assetType, "Image");
  });

  check("KIE Flux request shape", () => {
    const req = requireRequest(
      (r) => r.url.includes("/api/v1/jobs/createTask") && r.bodyText?.includes("flux-kontext-pro"),
      "flux createTask",
    );
    const body = parseJsonBody(req);
    assert.equal(body.model, "flux-kontext-pro");
    assert.equal(body.input.inputImage, "https://example.com/input.jpg");
    assert.equal(body.input.aspectRatio, "16:9");
    assert.equal(body.input.outputFormat, "jpeg");
  });

  check("KIE Wan 2.7 Pro normalized advanced params", () => {
    const req = requireRequest(
      (r) => r.url.includes("/api/v1/jobs/createTask") && r.bodyText?.includes("wan/2-7-image-pro"),
      "wan createTask",
    );
    const body = parseJsonBody(req);
    assert.equal(body.model, "wan/2-7-image-pro");
    assert.equal(body.input.n, 2);
    assert.equal(body.input.resolution, "2K");
    assert.ok(Array.isArray(body.input.color_palette));
    assert.deepEqual(body.input.color_palette[0], { color: "#FF0000", proportion: "50.00%" });
    assert.ok(Array.isArray(body.input.bbox_list));
    assert.deepEqual(body.input.bbox_list, [[[10, 10, 100, 100]]]);
  });

  check("KIE Ideogram remix num_images string", () => {
    const req = requireRequest(
      (r) => r.url.includes("/api/v1/jobs/createTask") && r.bodyText?.includes("ideogram/v3-remix"),
      "ideogram remix createTask",
    );
    const body = parseJsonBody(req);
    assert.equal(body.input.num_images, "4");
  });

  check("KIE Seedance reference_image_urls max 9 + duration", () => {
    const req = requireRequest(
      (r) => r.url.includes("/api/v1/jobs/createTask") && r.bodyText?.includes("bytedance/seedance-2-fast"),
      "seedance createTask",
    );
    const body = parseJsonBody(req);
    assert.equal(body.model, "bytedance/seedance-2-fast");
    assert.equal(body.input.duration, 8);
    assert.equal(body.input.reference_image_urls.length, 9);
  });

  check("HeyGen upload endpoint and headers", () => {
    const req = requireRequest((r) => r.url.includes("upload.heygen.com/v1/asset"), "heygen upload");
    assert.equal(req.method, "POST");
    const h = req.headers;
    const key = h["X-API-KEY"] || h["x-api-key"];
    assert.ok(key, "X-API-KEY missing");
    assert.equal(h["Content-Type"], "image/jpeg");
  });

  check("HeyGen photo generation status endpoint", () => {
    requireRequest((r) => r.url.includes("/v2/photo_avatar/generation/gen-1"), "photo generation status");
  });

  check("HeyGen video generation endpoint/payload", () => {
    const req = requireRequest((r) => r.url.includes("/v2/video/generate"), "video generate");
    const body = parseJsonBody(req);
    assert.ok(Array.isArray(body.video_inputs));
    assert.equal(body.video_inputs[0].character.avatar_id, "avatar-1");
    assert.equal(body.video_inputs[0].voice.type, "text");
    assert.equal(body.video_inputs[0].voice.elevenlabs_settings.model, "eleven_v3");
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log("\nSMOKE MATRIX (KIE + HeyGen)");
  for (const row of results) {
    console.log(`${row.ok ? "PASS" : "FAIL"} - ${row.name}${row.ok ? "" : ` -> ${row.error}`}`);
  }
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

await run();
