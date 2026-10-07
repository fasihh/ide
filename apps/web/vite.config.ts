import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SERVER = `http://127.0.0.1:${process.env.CP_IDE_SERVER_PORT ?? 7420}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Plugins live in their own workspace packages; make sure they share one React.
    dedupe: ["react", "react-dom", "monaco-editor"],
  },
  server: {
    port: 5173,
    proxy: { "/api": SERVER },
  },
});
