import fs from "node:fs";
import path from "node:path";

const DEBOUNCE_MS = 250;
const IGNORED = /(^|[\\/])(\.trash|node_modules|\.git)([\\/]|$)|\.tmp$/;

/**
 * Watches the problems root recursively and reports which problems changed (debounced).
 * A problem id is the folder that directly contains the changed file; folder-level changes
 * (new/removed problems) are reported with that folder's path so listeners refresh the list.
 */
export class ProblemsWatcher {
  private watcher: fs.FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private root = "";

  constructor(private onChange: (ids: string[]) => void) {}

  watch(root: string) {
    if (root === this.root && this.watcher) return;
    this.close();
    this.root = root;
    try {
      fs.mkdirSync(root, { recursive: true });
      this.watcher = fs.watch(root, { recursive: true }, (_event, file) => {
        if (!file || IGNORED.test(file)) return;
        const rel = file.split(path.sep).join("/");
        // "a/b/c/main.cpp" → problem "a/b/c"; "a/b/c" (folder event) → itself.
        const id = /\.[^/]+$/.test(rel) ? rel.slice(0, rel.lastIndexOf("/")) : rel;
        this.pending.add(id);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
      });
      this.watcher.on("error", (err) => console.warn("[watcher]", err.message));
    } catch (err: any) {
      console.warn(`[watcher] cannot watch ${root}: ${err.message}`);
    }
  }

  private flush() {
    const ids = [...this.pending];
    this.pending.clear();
    if (ids.length) this.onChange(ids);
  }

  close() {
    this.watcher?.close();
    this.watcher = null;
    clearTimeout(this.timer);
  }
}
