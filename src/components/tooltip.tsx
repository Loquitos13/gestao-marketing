"use client";

import * as T from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-lg border bg-surface px-3 py-2 text-xs leading-relaxed text-fg shadow-lg">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function InfoTip({ content }: { content: React.ReactNode }) {
  return (
    <Tip content={content}>
      <button type="button" aria-label="Mais informação" className="inline-flex text-muted hover:text-fg">
        <Info className="size-3.5" />
      </button>
    </Tip>
  );
}
