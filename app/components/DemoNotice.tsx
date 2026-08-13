'use client';

import React from 'react';

export const DEMO_NOTICE_TEXT = '⚠️ 本サイトは「Mercari AI Agent Hackathon for PM」提出用に作成したデモ・モックサイトです。株式会社メルカリおよび同社サービスとは一切関係ありません。';
export const DEMO_PRODUCT_LABEL = 'Furima Sandboxの動くフリマUIモック';

export const DemoNoticeBar: React.FC = () => (
  <div className="demo-notice-bar" role="note" aria-label={DEMO_NOTICE_TEXT}>
    <span className="sr-only">{DEMO_PRODUCT_LABEL}</span>
    <span>{DEMO_NOTICE_TEXT}</span>
  </div>
);

export const DemoNoticeCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <section className={`demo-notice-card ${className}`} aria-label="ご注意：本サイトについて">
    <img
      src="/images/marketing/furima-sandbox-notice.png"
      alt="ご注意。本サイトはMercari AI Agent Hackathon for PM提出用のデモ・モックサイトです。株式会社メルカリおよび同社サービスとは一切関係ありません。"
      className="block h-auto w-full"
      loading="eager"
      decoding="async"
    />
  </section>
);
