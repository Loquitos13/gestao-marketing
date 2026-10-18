"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md border px-3 py-1.5 text-xs hover:bg-surface-2">
      Imprimir
    </button>
  );
}
