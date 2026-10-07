import { useRegistry } from "../core/registry.ts";

export function StatusBar() {
  const items = useRegistry((s) => s.statusBar);
  const sorted = [...items].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 px-3 text-[0.6875rem] text-muted-foreground">
      {sorted
        .filter((i) => i.align === "left")
        .map((i) => (
          <i.component key={i.id} ctx={i.owner} />
        ))}
      <div className="flex-1" />
      {sorted
        .filter((i) => i.align === "right")
        .map((i) => (
          <i.component key={i.id} ctx={i.owner} />
        ))}
    </footer>
  );
}
