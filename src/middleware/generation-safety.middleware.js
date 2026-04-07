import { runGenerationSafetyCheck } from "../services/generation-safety-check.service.js";
import { recordChildSafetyIncident } from "../services/child-safety-report.service.js";

function isGenerationLikePath(pathname) {
  if (!pathname || typeof pathname !== "string") return false;
  if (/^\/api\/auth\/2fa\/generate$/.test(pathname)) return false;
  return (
    pathname.includes("/generate") ||
    pathname.includes("/soulx/") ||
    pathname.includes("/nsfw/") ||
    pathname.includes("/img2img/") ||
    pathname.includes("/upscale")
  );
}

export async function generationSafetyMiddleware(req, res, next) {
  try {
    if (req.method !== "POST") return next();
    const routePath = req.originalUrl?.split("?")[0] || req.path || "";
    if (!isGenerationLikePath(routePath)) return next();

    const verdict = await runGenerationSafetyCheck({
      routePath,
      body: req.body || {},
    });

    if (verdict?.blocked) {
      if (verdict.code === "safety_child_sexual_content") {
        try {
          await recordChildSafetyIncident({
            req,
            routePath,
            classifierCode: verdict.code,
          });
        } catch (reportErr) {
          console.error("[SafetyCheck] failed to persist child safety incident:", reportErr?.message || reportErr);
        }
      }
      const userFacingError = verdict.code === "safety_child_sexual_content"
        ? "Prompt failed because of unallowed content type."
        : (verdict.reason || "Generation blocked by safety policy.");
      return res.status(400).json({
        success: false,
        error: userFacingError,
        code: verdict.code || "safety_blocked",
      });
    }
  } catch (error) {
    // Fail-open to avoid breaking healthy traffic if classifier is temporarily unavailable.
    console.warn("[SafetyCheck] middleware warning:", error?.message || error);
  }
  return next();
}
