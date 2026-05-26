import type { Metadata } from 'next';
import '../index.css';

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
        {children}
      </body>
    </html>
  );
}
