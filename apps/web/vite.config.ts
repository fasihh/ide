import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SERVER = `http://127.0.0.1:${process.env.CP_IDE_SERVER_PORT ?? 7420}`;

// monaco-editor >= 0.5x maps "monaco-editor/*" to "esm/vs/*.js", which breaks libraries that
// import deep "monaco-editor/esm/vs/..." paths (e.g. monaco-vim). Point those at the files directly.
const require = createRequire(import.meta.url);
const MONACO_ROOT = path.resolve(path.dirname(require.resolve("monaco-editor")), "../..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Plugins live in their own workspace packages; make sure they share one React/Monaco.
    dedupe: ["react", "react-dom", "monaco-editor"],
    alias: [{ find: /^monaco-editor\/esm\/(.*?)(\.js)?$/, replacement: `${MONACO_ROOT.replace(/\\/g, "/")}/esm/$1.js` }],
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: SERVER, ws: true } },
  },
});
