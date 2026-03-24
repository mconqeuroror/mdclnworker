import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only use Replit error overlay on Replit; locally it can cause reload loops
const isReplit = process.env.REPL_ID !== undefined;

export default defineConfig({
  plugins: [
    react(),
    ...(isReplit ? [runtimeErrorOverlay()] : []),
    ...(process.env.NODE_ENV !== "production" && isReplit
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2200,
  },
  server: {
    allowedHosts: true, // allow Replit dev/live hosts (*.replit.dev, *.worf.replit.dev, etc.)
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Disable HMR when not on Replit to stop endless refresh loop (WebSocket/overlay can trigger reloads)
    hmr: isReplit ? (process.env.HMR_PORT ? { port: Number(process.env.HMR_PORT) } : true) : false,
  },
});
