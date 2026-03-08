"use client";

import { Suspense } from "react";
import RegistrarCobroPageClient from "./RegistrarCobroPageClient";

export default function RegistrarCobroPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      }
    >
      <RegistrarCobroPageClient />
    </Suspense>
  );
}