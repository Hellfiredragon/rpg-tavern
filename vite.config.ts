import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT || "3001";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
});
