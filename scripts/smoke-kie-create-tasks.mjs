import "dotenv/config";

const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_API_URL = "https://api.kie.ai/api/v1";

if (!KIE_API_KEY) {
  console.error("Missing KIE_API_KEY");
  process.exit(1);
}

async function createTask(label, body) {
  const res = await fetch(`${KIE_API_URL}/jobs/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIE_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} createTask HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text);
  const taskId = json?.data?.taskId;
  if (!taskId) throw new Error(`${label} missing taskId: ${text.slice(0, 200)}`);
  return { taskId, raw: json };
}

async function readTask(taskId) {
  const res = await fetch(`${KIE_API_URL}/jobs/recordInfo?taskId=${taskId}`, {
    headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 200) };
  try {
    const json = JSON.parse(text);
    return { ok: true, state: json?.data?.state || null, failMsg: json?.data?.failMsg || null };
  } catch {
    return { ok: false, status: "json", text: text.slice(0, 200) };
  }
}

async function run() {
  const sampleImage = "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=80";
  const sampleImage2 = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=80";
  const sampleVideo = "https://samplelib.com/lib/preview/mp4/sample-5s.mp4";

  const cases = [
    {
      label: "text-image nano-banana-2",
      body: {
        model: "nano-banana-2",
        input: { prompt: "studio portrait, realistic, soft lighting", aspect_ratio: "1:1" },
      },
    },
    {
      label: "image nano-banana-pro",
      body: {
        model: "nano-banana-pro",
        input: {
          prompt: "keep same person identity, portrait @element_person",
          aspect_ratio: "3:4",
          kling_elements: [
            {
              name: "element_person",
              description: "person identity",
              element_input_urls: [sampleImage, sampleImage2],
            },
          ],
        },
      },
    },
    {
      label: "advanced seedream-edit",
      body: {
        model: "seedream/4.5-edit",
        input: {
          prompt: "photorealistic portrait refinement with natural skin detail",
          image_urls: [sampleImage, sampleImage2],
          aspect_ratio: "9:16",
          quality: "basic",
        },
      },
    },
    {
      label: "video prompt kling-3.0/video",
      body: {
        model: "kling-3.0/video",
        input: {
          mode: "std",
          image_urls: [sampleImage],
          prompt: "cinematic gentle camera move",
          duration: "5",
          aspect_ratio: "9:16",
          multi_shots: false,
          sound: false,
        },
      },
    },
    {
      label: "video recreate kling-2.6/motion-control",
      body: {
        model: "kling-2.6/motion-control",
        input: {
          prompt: "smooth realistic motion",
          input_urls: [sampleImage],
          video_urls: [sampleVideo],
          mode: "720p",
          character_orientation: "image",
        },
      },
    },
  ];

  const out = [];
  for (const c of cases) {
    try {
      const created = await createTask(c.label, c.body);
      await new Promise((r) => setTimeout(r, 2500));
      const status = await readTask(created.taskId);
      out.push({ label: c.label, taskId: created.taskId, status });
    } catch (e) {
      out.push({ label: c.label, error: e.message });
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});

