import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

/** The official clangd releases (https://github.com/clangd/clangd/releases). */
export const RELEASES_API = "https://api.github.com/repos/clangd/clangd/releases/latest";

const ASSET_PREFIX: Partial<Record<NodeJS.Platform, string>> = { win32: "clangd-windows-", linux: "clangd-linux-", darwin: "clangd-mac-" };
const EXE = (platform: NodeJS.Platform) => (platform === "win32" ? "clangd.exe" : "clangd");

export type Release = { version: string; asset: string; url: string; sizeBytes: number };

export interface InstallerOptions {
  /** Folder that holds downloaded releases (`<plugin data dir>/clangd`). */
  dir: string;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
}

/**
 * Downloads an official clangd release into a folder this plugin owns, so C++ language support works
 * without a system-wide install. Only runs when the user asks for it.
 */
export class ClangdInstaller {
  private readonly fetch: typeof fetch;
  private readonly platform: NodeJS.Platform;
  private installing: Promise<string> | null = null;

  constructor(private readonly options: InstallerOptions) {
    this.fetch = options.fetch ?? fetch;
    this.platform = options.platform ?? process.platform;
  }

  /** Path of the newest downloaded clangd, or null. */
  async installed(): Promise<string | null> {
    const entries = await fs.readdir(this.options.dir).catch(() => [] as string[]);
    for (const name of entries.filter((e) => e.startsWith("clangd_")).sort(byVersionDesc)) {
      const exe = path.join(this.options.dir, name, "bin", EXE(this.platform));
      if (await fs.access(exe).then(() => true, () => false)) return exe;
    }
    return null;
  }

  /** The latest release for this platform (one small GitHub API request). */
  async latest(): Promise<Release> {
    const prefix = ASSET_PREFIX[this.platform];
    if (!prefix) throw new Error(`No clangd release for ${this.platform}`);
    const res = await this.fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "cp-ide" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] };
    const asset = release.assets.find((a) => a.name.startsWith(prefix) && a.name.endsWith(".zip"));
    if (!asset) throw new Error(`The latest release has no ${prefix}*.zip`);
    return { version: release.tag_name, asset: asset.name, url: asset.browser_download_url, sizeBytes: asset.size };
  }

  /** Download and unpack the latest release; resolves to the clangd executable. One install at a time. */
  install(): Promise<string> {
    this.installing ??= this.doInstall().finally(() => (this.installing = null));
    return this.installing;
  }

  private async doInstall(): Promise<string> {
    const release = await this.latest();
    const res = await this.fetch(release.url, { headers: { "User-Agent": "cp-ide" } });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const root = path.resolve(this.options.dir);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const target = path.resolve(root, name);
      // Reject entries that would land outside the folder ("zip slip").
      if (!target.startsWith(root + path.sep)) throw new Error(`Unsafe path in archive: ${name}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
      if (this.platform !== "win32" && /\/bin\//.test(name)) await fs.chmod(target, 0o755);
    }
    const exe = await this.installed();
    if (!exe) throw new Error("The archive did not contain clangd");
    return exe;
  }
}

/** `clangd_21.1.8` before `clangd_9.0.0`. */
function byVersionDesc(a: string, b: string) {
  const parts = (s: string) => s.replace(/^clangd_/, "").split(".").map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
