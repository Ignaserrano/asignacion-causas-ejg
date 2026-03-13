"use client";

import { useEffect, useState } from "react";

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 400);
    }

    window.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  if (!visible) return null;

  return (
    <button
      onClick={scrollToTop}
      aria-label="Volver arriba"
      className="
        fixed bottom-6 right-6 z-50
        rounded-full
        border border-gray-300
        bg-white
        px-4 py-3
        text-sm font-black
        shadow-lg
        transition
        hover:bg-gray-50
        dark:border-gray-700
        dark:bg-gray-800
        dark:text-gray-100
        dark:hover:bg-gray-700
      "
    >
      ↑
    </button>
  );
}