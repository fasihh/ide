import { create } from "zustand";
import type { QuickPickItem, UiApi } from "@cp-ide/plugin-api/web";

export type UiRequest =
  | { kind: "pick"; items: QuickPickItem<unknown>[]; placeholder?: string; title?: string; resolve: (v: unknown) => void }
  | {
      kind: "prompt";
      title: string;
      placeholder?: string;
      value?: string;
      validate?: (v: string) => string | undefined;
      resolve: (v: string | undefined) => void;
    }
  | { kind: "confirm"; title: string; message?: string; confirmLabel?: string; destructive?: boolean; resolve: (v: boolean) => void };

/** The one modal input shown by the shell (quick pick / prompt / confirm). */
export const useUiRequest = create<{ request: UiRequest | null }>(() => ({ request: null }));

function show(request: UiRequest) {
  // Opening a new request dismisses the current one.
  const cur = useUiRequest.getState().request;
  if (cur) dismiss(cur);
  useUiRequest.setState({ request });
}

function dismiss(r: UiRequest) {
  if (r.kind === "confirm") r.resolve(false);
  else r.resolve(undefined);
}

export function closeUi(result?: { value: unknown }) {
  const r = useUiRequest.getState().request;
  if (!r) return;
  useUiRequest.setState({ request: null });
  if (result) (r.resolve as (v: unknown) => void)(result.value);
  else dismiss(r);
}

export const uiApi: UiApi = {
  quickPick: (items, options) =>
    new Promise((resolve) => show({ kind: "pick", items, ...options, resolve: resolve as (v: unknown) => void })),
  prompt: (options) => new Promise((resolve) => show({ kind: "prompt", ...options, resolve })),
  confirm: (options) => new Promise((resolve) => show({ kind: "confirm", ...options, resolve })),
};
