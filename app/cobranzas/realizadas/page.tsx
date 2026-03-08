"use client";

import { Suspense } from "react";
import RealizadasPageClient from "./RealizadasPageClient";

export default function CobranzasRealizadasPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      }
    >
      <RealizadasPageClient />
    </Suspense>
  );
}