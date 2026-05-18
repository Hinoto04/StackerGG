"use client";

import { useEffect, useState } from "react";

interface CardImageProps {
  src: string;
  alt: string;
}

export function CardImage({ src, alt }: CardImageProps) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setFailed(false);
    setRetryKey(0);
  }, [src]);

  if (failed) {
    return (
      <button
        aria-label={`${alt} 이미지 다시 불러오기`}
        className="card-image-empty card-image-retry"
        type="button"
        onClick={() => {
          setFailed(false);
          setRetryKey((current) => current + 1);
        }}
      >
        <span>IMAGE</span>
      </button>
    );
  }

  return <img key={`${src}-${retryKey}`} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
