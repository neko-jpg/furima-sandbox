import type { Metadata } from 'next';
import { Noto_Sans_JP, Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const notoSansJP = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-noto-sans-jp',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const title = 'Furima Sandbox - Marketplace Simulation & Agent Evaluation';
const description = 'Human・NPC・AI Agentが同じ市場で行動し、Mesaによるシミュレーションと因果イベント、Wallet Ledgerを観測できるオープンなMarketplace Sandbox。';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;

  return {
    title,
    description,
    icons: { icon: '/favicon.svg' },
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: socialImage, width: 1729, height: 910, alt: 'Furima Sandbox — Marketplace Simulation & Agent Evaluation, powered by Mesa 3.5.1.' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${notoSansJP.variable} ${inter.variable} bg-[#121212] text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
