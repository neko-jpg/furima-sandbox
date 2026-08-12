import type { Metadata } from 'next';
import { Noto_Sans_JP, Inter } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'メルカリ - 日本最大のフリマサービス (UI Mock)',
  description: 'メルカリの動くUIモックアプリ。ハッカソンAIエージェント連携対応。',
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
      <body className={`${notoSansJP.variable} ${inter.variable} bg-[#121212] text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
