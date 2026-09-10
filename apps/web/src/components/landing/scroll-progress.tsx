'use client';

import { useEffect, useState } from 'react';

// Thin gradient bar at the very top that tracks scroll progress.
export function ScrollProgress() {
  const [p, setP] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setP(max > 0 ? doc.scrollTop / max : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-0.5 bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-violet-500 via-indigo-500 to-fuchsia-500 shadow-[0_0_8px_rgba(124,92,255,0.6)]"
        style={{ width: `${p * 100}%` }}
      />
    </div>
  );
}
