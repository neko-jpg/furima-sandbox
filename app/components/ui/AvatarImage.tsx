'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useState } from 'react';
import { getListingMedia } from '../../media/listingMediaStore';

export const AvatarImage: React.FC<{ src: string; mediaRef?: string; alt: string; className?: string }> = ({ src, mediaRef, alt, className }) => {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  useEffect(() => {
    let cancelled = false;
    if (mediaRef) void getListingMedia(mediaRef).then((preview) => { if (!cancelled && preview) setResolvedSrc(preview); });
    return () => { cancelled = true; };
  }, [mediaRef]);
  return <img src={mediaRef ? resolvedSrc : src} alt={alt} className={className} />;
};
