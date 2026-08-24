import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Furima Sandbox - みつかる、つながる、フリマモック',
  description: 'Furima Sandboxの動くフリマUIモック。Mercari AI Agent Hackathon for PM提出用デモ。',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-[#121212] text-white antialiased">{children}</body>
    </html>
  );
}
