import express from "express";
import {
  getAdminLanderNewConfigBundle,
  publishLanderNewConfig,
  saveDraftLanderNewConfig,
} from "../services/lander-new-config.service.js";

const router = express.Router();

router.get("/config", async (_req, res) => {
  try {
    const bundle = await getAdminLanderNewConfigBundle();
    res.json({ success: true, ...bundle });
  } catch (error) {
    console.error("GET /admin/lander-new/config error:", error);
    res.status(500).json({ success: false, message: "Failed to load lander editor data" });
  }
});

router.put("/draft", async (req, res) => {
  try {
    const saved = await saveDraftLanderNewConfig(req.body?.config || {});
    res.json({ success: true, draft: saved });
  } catch (error) {
    console.error("PUT /admin/lander-new/draft error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to save draft" });
  }
});

router.post("/publish", async (_req, res) => {
  try {
    const published = await publishLanderNewConfig();
    res.json({ success: true, published });
  } catch (error) {
    console.error("POST /admin/lander-new/publish error:", error);
    res.status(500).json({ success: false, message: "Failed to publish lander config" });
  }
});

export default router;

