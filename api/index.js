// Vercel serverless entry point.
// FFmpeg (ffmpeg-static/ffprobe-static) is excluded from the bundle to stay under 250 MB.
// Repurposer returns a clear "not available on serverless" message on Vercel.

// Static import so Vercel's NFT bundler traces proxy-agent and transitive deps into the lambda.
import "proxy-agent";

import app from "../src/server.js";

export default app;
