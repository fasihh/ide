import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, cn } from "@cp-ide/ui";
import { fuzzyMatch } from "@cp-ide/shared";
import { type UiRequest, closeUi, rememberConfirm, useUiRequest } from "../core/ui.ts";

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-primary">
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </>
  );
}

function Pick({ request }: { request: Extract<UiRequest, { kind: "pick" }> }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return request.items.map((item) => ({ item, indices: [] as number[], score: 0 }));
    return request.items
      .map((item) => {
        const m = fuzzyMatch(query, item.label);
        const d = m ? null : item.description ? fuzzyMatch(query, item.description) : null;
        return m ? { item, indices: m.indices, score: m.score + 2 } : d ? { item, indices: [], score: d.score } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);
  }, [query, request.items]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      {request.title && <div className="px-3 pt-2.5 text-[0.6875rem] font-medium text-muted-foreground">{request.title}</div>}
      <div className="p-2">
        <Input
          autoFocus
          className="h-8 text-sm"
          placeholder={request.placeholder ?? "Type to search"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = results.length;
              if (n) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = results[active];
              if (r) closeUi({ value: r.item.value });
            }
          }}
        />
      </div>
      <div ref={listRef} className="max-h-[min(60vh,26rem)] overflow-y-auto px-1 pb-1">
        {results.map((r, i) => (
          <div
            key={i}
            data-index={i}
            onMouseMove={() => setActive(i)}
            onClick={() => closeUi({ value: r.item.value })}
            className={cn(
              "flex cursor-default items-center gap-3 rounded-sm px-2 py-1.5 text-xs select-none",
              i === active && "bg-accent text-accent-foreground",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <Highlight text={r.item.label} indices={r.indices} />
                {r.item.description && <span className="ml-2 text-muted-foreground">{r.item.description}</span>}
              </div>
              {r.item.detail && <div className="truncate text-[0.6875rem] text-muted-foreground">{r.item.detail}</div>}
            </div>
            {r.item.hint && <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">{r.item.hint}</span>}
          </div>
        ))}
        {results.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</div>}
      </div>
    </>
  );
}

/** Focus on mount, and again after menus that opened the dialog hand focus back to their trigger. */
function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
    const t = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, []);
  return ref;
}

function Prompt({ request }: { request: Extract<UiRequest, { kind: "prompt" }> }) {
  const [value, setValue] = useState(request.value ?? "");
  const error = request.validate?.(value);
  const input = useAutoFocus<HTMLInputElement>();
  return (
    <form
      className="space-y-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!error) closeUi({ value });
      }}
    >
      <div className="text-xs font-medium">{request.title}</div>
      <Input ref={input} className="h-8 text-sm" placeholder={request.placeholder} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
      <div className="flex h-4 items-center justify-between text-[0.6875rem]">
        <span className="text-destructive">{value && error}</span>
        <span className="text-muted-foreground">Enter to confirm · Esc to cancel</span>
      </div>
    </form>
  );
}

function Confirm({ request }: { request: Extract<UiRequest, { kind: "confirm" }> }) {
  const [remember, setRemember] = useState(false);
  const confirmButton = useAutoFocus<HTMLButtonElement>();
  const { rememberKey } = request;
  return (
    <div className="space-y-3 p-4">
      <div className="text-sm font-medium">{request.title}</div>
      {request.message && <div className="text-xs text-muted-foreground">{request.message}</div>}
      {rememberKey && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Don't ask again
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => closeUi()}>
          Cancel
        </Button>
        <Button
          ref={confirmButton}
          variant={request.destructive ? "destructive" : "default"}
          onClick={() => {
            if (rememberKey && remember) rememberConfirm(rememberKey);
            closeUi({ value: true });
          }}
        >
          {request.confirmLabel ?? "OK"}
        </Button>
      </div>
    </div>
  );
}

/** Renders the active quick pick / prompt / confirm request, VS Code style (top-center). */
export function QuickInput() {
  const request = useUiRequest((s) => s.request);
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeUi();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request]);

  // Remount the content for every new request so local state starts fresh.
  const key = useMemo(() => Math.random().toString(36), [request]);
  if (!request) return null;
  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => e.target === e.currentTarget && closeUi()}>
      <div
        key={key}
        className={cn(
          "absolute left-1/2 -translate-x-1/2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl",
          request.kind === "confirm" ? "top-[20%] w-[min(26rem,calc(100%-2rem))]" : "top-12 w-[min(38rem,calc(100%-2rem))]",
        )}
      >
        {request.kind === "pick" && <Pick request={request} />}
        {request.kind === "prompt" && <Prompt request={request} />}
        {request.kind === "confirm" && <Confirm request={request} />}
      </div>
    </div>
  );
}
