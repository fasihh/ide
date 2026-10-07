import { useEffect } from "react";
import { create } from "zustand";
import type { LibraryApi } from "@cp-ide/plugin-api/web";
import type { LibraryItem, LibraryKind } from "@cp-ide/shared";
import { api, unwrap } from "../api.ts";
import { reportError } from "./notify.ts";

const useLibrary = create<Partial<Record<LibraryKind, LibraryItem[]>>>(() => ({}));
const loading = new Set<LibraryKind>();

async function list(kind: LibraryKind) {
  const items = await unwrap(api.library[":kind"].$get({ param: { kind } }));
  useLibrary.setState({ [kind]: items });
  return items;
}

export const libraryApi: LibraryApi = {
  list,
  use(kind) {
    const items = useLibrary((s) => s[kind]);
    useEffect(() => {
      if (items || loading.has(kind)) return;
      loading.add(kind);
      list(kind)
        .catch(reportError("Could not load library"))
        .finally(() => loading.delete(kind));
    }, [items, kind]);
    return items;
  },
  async save(kind, name, content) {
    await unwrap(api.library[":kind"].$put({ param: { kind }, json: { name, content } }));
    useLibrary.setState((s) => ({ [kind]: s[kind]?.map((i) => (i.name === name ? { ...i, content } : i)) }));
  },
  async create(kind, name, content) {
    useLibrary.setState({ [kind]: await unwrap(api.library[":kind"].create.$post({ param: { kind }, json: { name, content } })) });
  },
  async rename(kind, from, to) {
    useLibrary.setState({ [kind]: await unwrap(api.library[":kind"].rename.$post({ param: { kind }, json: { from, to } })) });
  },
  async remove(kind, name) {
    useLibrary.setState({ [kind]: await unwrap(api.library[":kind"].delete.$post({ param: { kind }, json: { name } })) });
  },
};
