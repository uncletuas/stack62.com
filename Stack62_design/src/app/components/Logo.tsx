export function Logo({ size = 28 }: { size?: number }) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Stack62"
    >
      <defs>
        <linearGradient id="s62-back" x1="28" y1="28" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#4338CA" />
        </linearGradient>
        <linearGradient id="s62-front" x1="6" y1="6" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A5B4FC" />
          <stop offset="100%" stopColor="#818CF8" />
        </linearGradient>
      </defs>
      <rect x="22" y="22" width="36" height="36" rx="8" fill="url(#s62-back)" />
      <rect x="6" y="6" width="36" height="36" rx="8" fill="url(#s62-front)" />
    </svg>
  );
}
