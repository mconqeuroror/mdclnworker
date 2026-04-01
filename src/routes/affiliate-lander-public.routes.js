import express from "express";
import { getPublishedAffiliateLanderConfig } from "../services/affiliate-lander.service.js";

const router = express.Router();

router.get("/:suffix/published", async (req, res) => {
  try {
    const config = await getPublishedAffiliateLanderConfig(req.params.suffix);
    if (!config) {
      return res.status(404).json({ success: false, message: "Lander not found" });
    }
    res.json({ success: true, config });
  } catch (error) {
    console.error("GET /affiliate-lander/:suffix/published error:", error);
    res.status(500).json({ success: false, message: "Failed to load lander" });
  }
});

export default router;
