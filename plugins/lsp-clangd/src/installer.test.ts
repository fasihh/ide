import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { ClangdInstaller, RELEASES_API } from "./installer.ts";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-ide-clangd-installer-"));
after(() => fs.rm(root, { recursive: true, force: true }));

/** A fake GitHub: the releases API and one downloadable zip. */
function fakeFetch(zip: Uint8Array, assetName = "clangd-windows-99.1.0.zip"): typeof fetch {
  return (async (url: string | URL) => {
    if (String(url) === RELEASES_API) {
      return Response.json({
        tag_name: "99.1.0",
        assets: [
          { name: "clangd-linux-99.1.0.zip", browser_download_url: "https://example/linux.zip", size: 1 },
          { name: assetName, browser_download_url: "https://example/asset.zip", size: zip.length },
        ],
      });
    }
    if (String(url) === "https://example/asset.zip") return new Response(new Uint8Array(zip).buffer);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("downloads the release for this platform and finds the newest copy", async () => {
  const dir = path.join(root, "a");
  const zip = zipSync({ "clangd_99.1.0/bin/clangd.exe": strToU8("exe"), "clangd_99.1.0/lib/clang/99/include/stddef.h": strToU8("h") });
  const installer = new ClangdInstaller({ dir, fetch: fakeFetch(zip), platform: "win32" });

  assert.equal(await installer.installed(), null);
  assert.deepEqual(await installer.latest(), { version: "99.1.0", asset: "clangd-windows-99.1.0.zip", url: "https://example/asset.zip", sizeBytes: zip.length });
  const exe = await installer.install();
  assert.equal(exe, path.join(dir, "clangd_99.1.0", "bin", "clangd.exe"));
  assert.equal(await fs.readFile(path.join(dir, "clangd_99.1.0", "lib", "clang", "99", "include", "stddef.h"), "utf8"), "h");

  await fs.mkdir(path.join(dir, "clangd_100.0.0", "bin"), { recursive: true });
  await fs.writeFile(path.join(dir, "clangd_100.0.0", "bin", "clangd.exe"), "newer");
  assert.equal(await installer.installed(), path.join(dir, "clangd_100.0.0", "bin", "clangd.exe"), "versions compare numerically");
});

test("refuses archives that write outside the folder", async () => {
  const dir = path.join(root, "b");
  const zip = zipSync({ "../escape.txt": strToU8("x"), "clangd_1.0.0/bin/clangd.exe": strToU8("exe") });
  await assert.rejects(new ClangdInstaller({ dir, fetch: fakeFetch(zip), platform: "win32" }).install(), /Unsafe path/);
  await assert.rejects(fs.access(path.join(root, "escape.txt")));
});

test("reports platforms without a release", async () => {
  await assert.rejects(new ClangdInstaller({ dir: root, fetch: fakeFetch(new Uint8Array()), platform: "aix" }).latest(), /No clangd release/);
});
