import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Asignación de Causas EJG",
  description: "Sistema de asignación de causas del EJG",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
<html lang="es" suppressHydrationWarning>
  <head>
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function () {
            try {
              var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              var root = document.documentElement;
              if (isDark) root.classList.add('dark');
              else root.classList.remove('dark');
            } catch (e) {}
          })();
        `,
      }}
    />
  </head>
  <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100`}>
  {children}
</body>
    </html>
  );
}
