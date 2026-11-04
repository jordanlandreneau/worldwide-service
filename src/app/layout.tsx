import type { ReactNode } from "react";

export const metadata = { title: "Worldwide Service" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" />
        <link rel="stylesheet" href="/worldwide.css" />
        <link rel="stylesheet" href="/app-extras.css" />
        
      </head>
      <body className="__variable_16eff0 __variable_9f0762 __variable_fcd116 font-sans antialiased">{children}</body>
    </html>
  );
}
