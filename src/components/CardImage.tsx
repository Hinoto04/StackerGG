"use client";

import { useState } from "react";

interface CardImageProps {
  src: string;
  alt: string;
}

export function CardImage({ src, alt }: CardImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="card-image-empty">
        <span>IMAGE</span>
      </div>
    );
  }

  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
