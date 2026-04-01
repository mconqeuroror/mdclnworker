import express from "express";
import {
  listAffiliateLanders,
  createAffiliateLander,
  getAdminAffiliateLanderBundle,
  saveDraftAffiliateLander,
  publishAffiliateLander,
  deleteAffiliateLander,
  assertValidSuffix,
} from "../services/affiliate-lander.service.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const items = await listAffiliateLanders();
    res.json({ success: true, items });
  } catch (error) {
    console.error("GET /admin/affiliate-lander error:", error);
    res.status(500).json({ success: false, message: "Failed to list affiliate landers" });
  }
});

router.post("/", async (req, res) => {
  try {
    const suffix = assertValidSuffix(req.body?.suffix);
    const row = await createAffiliateLander(suffix);
    res.json({ success: true, suffix: row.suffix });
  } catch (error) {
    const msg = error?.message || "Failed to create";
    if (msg.includes("already in use")) {
      return res.status(409).json({ success: false, message: msg });
    }
    if (msg.includes("Suffix") || msg.includes("path") || msg.includes("reserved") || msg.includes("hyphens")) {
      return res.status(400).json({ success: false, message: msg });
    }
    console.error("POST /admin/affiliate-lander error:", error);
    res.status(500).json({ success: false, message: "Failed to create affiliate lander" });
  }
});

router.get("/:suffix/config", async (req, res) => {
  try {
    const bundle = await getAdminAffiliateLanderBundle(req.params.suffix);
    if (!bundle) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, ...bundle });
  } catch (error) {
    console.error("GET /admin/affiliate-lander/:suffix/config error:", error);
    res.status(500).json({ success: false, message: "Failed to load config" });
  }
});

router.put("/:suffix/draft", async (req, res) => {
  try {
    const saved = await saveDraftAffiliateLander(req.params.suffix, req.body?.config || {});
    res.json({ success: true, draft: saved });
  } catch (error) {
    const msg = error?.message || "Failed to save";
    if (msg.includes("not found")) {
      return res.status(404).json({ success: false, message: msg });
    }
    console.error("PUT /admin/affiliate-lander/:suffix/draft error:", error);
    res.status(400).json({ success: false, message: msg });
  }
});

router.post("/:suffix/publish", async (req, res) => {
  try {
    const published = await publishAffiliateLander(req.params.suffix);
    res.json({ success: true, published });
  } catch (error) {
    const msg = error?.message || "Failed to publish";
    if (msg.includes("not found")) {
      return res.status(404).json({ success: false, message: msg });
    }
    console.error("POST /admin/affiliate-lander/:suffix/publish error:", error);
    res.status(500).json({ success: false, message: msg });
  }
});

router.delete("/:suffix", async (req, res) => {
  try {
    await deleteAffiliateLander(req.params.suffix);
    res.json({ success: true });
  } catch (error) {
    console.error("DELETE /admin/affiliate-lander/:suffix error:", error);
    res.status(500).json({ success: false, message: "Failed to delete" });
  }
});

export default router;
