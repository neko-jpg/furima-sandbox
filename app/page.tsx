'use client';

import { MercariProvider } from './context/MercariContext';
import { MercariApp } from './components/MercariApp';

export default function Home() {
  return (
    <MercariProvider>
      <MercariApp />
    </MercariProvider>
  );
}
