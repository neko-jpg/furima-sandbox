'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Keep the production UI recoverable without exposing stack traces or
    // request payloads to users.
    console.error('Furima Sandbox UI error', { digest: error.digest });
  }, [error.digest]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#121212] p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1f1f21] p-6 shadow-2xl" role="alert">
        <h1 className="text-lg font-black">画面を復旧できませんでした</h1>
        <p className="mt-2 text-sm leading-6 text-white/65">Sandboxの状態は保持したまま、画面を再試行できます。</p>
        <button type="button" onClick={reset} className="mt-5 w-full rounded-xl bg-[#00c853] px-4 py-3 text-sm font-black text-[#06202e]">もう一度試す</button>
      </section>
    </main>
  );
}
