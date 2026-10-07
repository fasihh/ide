import { useEffect, useState } from "react";
import { create } from "zustand";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import type { Language } from "@cp-ide/shared";
import {
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cp-ide/ui";

type Prefill = { platform?: string; group?: string };
export const useNewProblemDialog = create<{ open: boolean; prefill: Prefill }>(() => ({ open: false, prefill: {} }));
/** Open the dialog, optionally with platform/contest filled in (e.g. "New problem here…"). */
export const openNewProblemDialog = (prefill: Prefill = {}) => useNewProblemDialog.setState({ open: true, prefill });

const DEFAULT_TEMPLATE = "";

const PLATFORMS = ["codeforces", "cses", "leetcode", "atcoder", "codechef", "custom"];

/** Mounted from a toolbar item so it is available no matter which panels are open. */
export function NewProblemDialog({ ctx }: PanelProps) {
  const open = useNewProblemDialog((s) => s.open);
  const prefill = useNewProblemDialog((s) => s.prefill);
  const templates = ctx.library.use("templates");
  const defaultCpp = ctx.settings.use("templates.defaultCpp");
  const defaultPy = ctx.settings.use("templates.defaultPython");
  const problems = ctx.workspace.use((s) => s.problems);
  const defaultLanguage = ctx.settings.use("problems.defaultLanguage");
  const [form, setForm] = useState({
    name: "",
    platform: "custom",
    group: "misc",
    url: "",
    language: defaultLanguage as Language,
    timeLimit: "",
    template: DEFAULT_TEMPLATE,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open)
      setForm((f) => ({
        ...f,
        name: "",
        url: "",
        language: defaultLanguage,
        template: DEFAULT_TEMPLATE,
        platform: prefill.platform ?? f.platform,
        group: prefill.group ?? f.group,
      }));
  }, [open, defaultLanguage, prefill]);

  const languageTemplates = (templates ?? []).filter((t) => t.language === form.language);
  const defaultName = form.language === "cpp" ? defaultCpp : defaultPy;

  const platforms = [...new Set([...PLATFORMS, ...problems.map((p) => p.platform)])];
  const groups = [...new Set(problems.filter((p) => p.platform === form.platform).map((p) => p.group))];
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await ctx.workspace.createProblem({
        name: form.name.trim(),
        platform: form.platform.trim() || "custom",
        group: form.group.trim() || "misc",
        url: form.url.trim() || undefined,
        language: form.language,
        timeLimitMs: form.timeLimit ? Number(form.timeLimit) : undefined,
        template: form.template || undefined,
      });
      useNewProblemDialog.setState({ open: false });
    } catch (err) {
      ctx.notify.error("Could not create problem", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => useNewProblemDialog.setState({ open: o })}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New problem</DialogTitle>
          <DialogDescription>Stored under problems root / platform / group / name.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="np-name">Name</Label>
            <Input id="np-name" autoFocus placeholder="A. Watermelon" value={form.name} onChange={set("name")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-platform">Platform</Label>
              <Combobox id="np-platform" value={form.platform} options={platforms} onChange={(platform) => setForm((f) => ({ ...f, platform }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-group">Contest / group</Label>
              <Combobox
                id="np-group"
                placeholder="Round 945 (Div. 2)"
                value={form.group}
                options={groups}
                onChange={(group) => setForm((f) => ({ ...f, group }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-url">URL (optional)</Label>
            <Input id="np-url" placeholder="https://codeforces.com/contest/…" value={form.url} onChange={set("url")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Language</Label>
              <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v as Language, template: DEFAULT_TEMPLATE })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpp">C++</SelectItem>
                  <SelectItem value="python">Python</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-tl">Time limit (ms)</Label>
              <Input id="np-tl" type="number" min={100} placeholder="default" value={form.timeLimit} onChange={set("timeLimit")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Template</Label>
            <Select value={form.template || "__default"} onValueChange={(v) => setForm({ ...form, template: v === "__default" ? "" : v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default">Default ({defaultName})</SelectItem>
                {languageTemplates
                  .filter((t) => t.name !== defaultName)
                  .map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-1">
            <Button type="button" variant="ghost" onClick={() => useNewProblemDialog.setState({ open: false })}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
