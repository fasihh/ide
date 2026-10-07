import type * as React from "react";
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "../lib.ts";

export const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded px-1.5 py-px text-[0.625rem] font-semibold tracking-wide whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border text-muted-foreground",
        AC: "bg-verdict-ac/15 text-verdict-ac",
        WA: "bg-verdict-wa/15 text-verdict-wa",
        TLE: "bg-verdict-tle/15 text-verdict-tle",
        RE: "bg-verdict-re/15 text-verdict-re",
        OLE: "bg-verdict-re/15 text-verdict-re",
        CE: "bg-verdict-ce/15 text-verdict-ce",
        RAN: "bg-verdict-ran/15 text-verdict-ran",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
