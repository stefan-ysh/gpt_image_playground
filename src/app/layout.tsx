import type { Metadata } from 'next';
import '../index.css';
import CssReadyGate from '../components/CssReadyGate';

export const metadata: Metadata = {
  title: 'Image Studio',
  description: 'A multi-provider image generation and management workspace.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <link rel="image studio icon" href="./favicon.ico"></link>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root:not([data-app-css-ready]) body {
                visibility: hidden;
              }
            `,
          }}
        />
      </head>
      <body className="antialiased overflow-hidden">
        <CssReadyGate />
        {children}
      </body>
    </html>
  );
}
