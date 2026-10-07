import fs from "node:fs/promises";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Write via a temp file + rename so readers never see half a file. On Windows the rename can
 * fail briefly (antivirus, a concurrent reader); retry, then fall back to writing in place.
 */
export async function writeFileAtomic(file: string, data: string) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err: any) {
      if (!TRANSIENT.has(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 25 * 2 ** attempt));
    }
  }
  await fs.writeFile(file, data);
  await fs.rm(tmp, { force: true });
}
