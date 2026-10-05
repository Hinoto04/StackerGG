"use client";

import { useEffect, useState } from "react";
import { getOfficialCardImageFallbackUrl } from "@/data/cards";

interface CardImageProps {
  src: string;
  alt: string;
}

export function CardImage({ src, alt }: CardImageProps) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [useFallback, setUseFallback] = useState(false);
  const fallbackSrc = getOfficialCardImageFallbackUrl(src);
  const imageSrc = useFallback && fallbackSrc ? fallbackSrc : src;

  useEffect(() => {
    setFailed(false);
    setRetryKey(0);
    setUseFallback(false);
  }, [src]);

  if (failed) {
    return (
      <button
        aria-label={`${alt} 이미지 다시 불러오기`}
        className="card-image-empty card-image-retry"
        type="button"
        onClick={() => {
          setFailed(false);
          setUseFallback(false);
          setRetryKey((current) => current + 1);
        }}
      >
        <span>IMAGE</span>
      </button>
    );
  }

  return (
    <img
      key={`${imageSrc}-${retryKey}`}
      src={imageSrc}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (!useFallback && fallbackSrc) {
          setUseFallback(true);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
