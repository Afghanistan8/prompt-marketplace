import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '../lib/providers';

export const metadata: Metadata = {
  title: 'AI Prompt Marketplace',
  description: 'On-chain prompt marketplace powered by GenLayer',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
