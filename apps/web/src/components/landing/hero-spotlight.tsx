'use client';

import { useEffect, useRef } from 'react';

// A radial glow that follows the pointer across the hero section (its parent element).
export function HeroSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const section = el?.parentElement;
    if (!el || !section) return;
    const onMove = (e: MouseEvent) => {
      const r = section.getBoundingClientRect();
      el.style.setProperty('--hx', `${e.clientX - r.left}px`);
      el.style.setProperty('--hy', `${e.clientY - r.top}px`);
    };
    section.addEventListener('mousemove', onMove);
    return () => section.removeEventListener('mousemove', onMove);
  }, []);

  return <div ref={ref} aria-hidden className="lg-hero-spot pointer-events-none absolute inset-0" />;
}
