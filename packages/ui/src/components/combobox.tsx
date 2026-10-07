import { useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../lib.ts";
import { Input } from "./input.tsx";

/**
 * Free-text input with a suggestion list. Unlike `<datalist>`, opening it shows every option;
 * the list only filters once the user starts typing.
 */
export function Combobox({
  value,
  onChange,
  options,
  id,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  id?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  const q = value.trim().toLowerCase();
  const shown = filtering && q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const isOpen = open && shown.length > 0;

  const show = () => {
    setOpen(true);
    setFiltering(false);
    setActive(Math.max(0, options.indexOf(value)));
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchorRef} className={cn("relative", className)}>
          <Input
            id={id}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            className="pr-7"
            onFocus={show}
            onClick={() => !open && show()}
            onChange={(e) => {
              onChange(e.target.value);
              setFiltering(true);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!isOpen) return show();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setActive((a) => (a + d + shown.length) % shown.length);
              } else if (e.key === "Enter" && isOpen && shown[active] !== undefined) {
                e.preventDefault();
                pick(shown[active]!);
              } else if (e.key === "Escape" && isOpen) {
                e.preventDefault();
                e.stopPropagation(); // don't close an enclosing dialog
                setOpen(false);
              } else if (e.key === "Tab") {
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Show options"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (isOpen ? setOpen(false) : show())}
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-50 max-h-56 w-(--radix-popover-trigger-width) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {shown.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={cn(
                "cursor-default truncate rounded-sm px-2 py-1 text-xs select-none",
                i === active && "bg-accent text-accent-foreground",
                o === value && "font-medium",
              )}
            >
              {o}
            </div>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
