import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "give-to-get.com — Give contacts. Get contacts.",
  description: "B2B contact database exchange. Upload your contact list, earn credits, and download verified contacts filtered by vertical, seniority, and company size.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body {
            margin: 0;
            background: #0C0C0F;
            color: #F0EEFF;
            font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          ::-webkit-scrollbar { width: 5px; height: 5px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.25); border-radius: 3px; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
