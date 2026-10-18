"use client";

import { ThemeProvider } from "next-themes";
import * as Tooltip from "@radix-ui/react-tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Tooltip.Provider delayDuration={200}>{children}</Tooltip.Provider>
    </ThemeProvider>
  );
}
