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

const title = 'Furima Sandbox - ユーザー間で循環するフリマ体験';
const description = 'Furima Sandboxの動くフリマUIモック。架空ユーザーとして出品・購入・発送・評価までを体験し、すべての市場状態をAPIから観測できるOSSサンドボックス。';

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
      images: [{ url: socialImage, width: 1728, height: 908, alt: 'Furima Sandbox — 同じ市場を、4人の視点で。' }],
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
