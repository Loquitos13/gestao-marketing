"use client";

import { FailureScreen } from "@/components/failure-screen";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FailureScreen error={error} reset={reset} />;
}
