import express from "express";
import { getPublishedLanderNewConfig } from "../services/lander-new-config.service.js";

const router = express.Router();

router.get("/config", async (_req, res) => {
  try {
    const config = await getPublishedLanderNewConfig();
    res.json({ success: true, config });
  } catch (error) {
    console.error("GET /lander-new/config error:", error);
    res.status(500).json({ success: false, message: "Failed to load lander config" });
  }
});

export default router;

