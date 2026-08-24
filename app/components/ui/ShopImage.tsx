'use client';

import React from 'react';
import Image from 'next/image';

interface ShopImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  width?: number;
  height?: number;
  sizes?: string;
}

/**
 * One image boundary for the sandbox. Local assets use Vinext's optimizer;
 * file previews remain plain images because data URLs cannot be optimized.
 */
export const ShopImage: React.FC<ShopImageProps> = ({ src, alt, className, loading = 'lazy', width = 800, height = 800, sizes = '(max-width: 768px) 50vw, 25vw' }) => {
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} loading={loading} />;
  }
  return <Image src={src} alt={alt} width={width} height={height} sizes={sizes} loading={loading} unoptimized={process.env.NODE_ENV === 'development'} className={className} />;
};
