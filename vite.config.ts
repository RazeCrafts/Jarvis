import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed dev port (see src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    watch: { ignored: ["**/src-tauri/**", "**/backend/**", "**/data/**"] },
  },
});
