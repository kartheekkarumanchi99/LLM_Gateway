'use client';

import { useState } from 'react';
import { brandFor } from '@/lib/brands';

// Renders a provider's real logo when available, falling back cleanly:
//   DB provider icon -> brand-domain favicon -> brand-colored initial.
export function ProviderLogo({
  slug,
  icon,
  size = 36,
  className = '',
}: {
  slug: string;
  icon?: string | null;
  size?: number;
  className?: string;
}) {
  const brand = brandFor(slug);
  const sources: string[] = [];
  if (icon && /^https?:\/\//.test(icon)) sources.push(icon);
  if (brand.domain) sources.push(`https://www.google.com/s2/favicons?domain=${brand.domain}&sz=64`);

  const [idx, setIdx] = useState(0);
  const src = sources[idx];

  if (src) {
    return (
      <span
        className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white ring-1 ring-gray-200 ${className}`}
        style={{ width: size, height: size }}
        title={brand.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={brand.name}
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          className="object-contain"
          loading="lazy"
          onError={() => setIdx((i) => i + 1)}
        />
      </span>
    );
  }

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-lg font-semibold text-white ${className}`}
      style={{ width: size, height: size, background: brand.color, fontSize: Math.round(size * 0.4) }}
      title={brand.name}
    >
      {brand.initial}
    </span>
  );
}
