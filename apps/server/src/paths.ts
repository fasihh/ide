import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "./errors.ts";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** App data: settings, compile cache, templates, plugin storage. */
export const DATA_DIR = path.resolve(expandHome(process.env.CP_IDE_HOME ?? "~/.cp-ide"));
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
export const PLUGIN_DATA_DIR = path.join(DATA_DIR, "plugins");

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
export const WEB_DIST = path.join(REPO_ROOT, "apps/web/dist");

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new HttpError(400, `Path escapes root: ${rel}`);
  }
  return abs;
}
