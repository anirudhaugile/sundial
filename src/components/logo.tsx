/** Sundial mark: a half sun over a horizon line with a gnomon shadow. */
export function SundialMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 16a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 16 16.5 10.5" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M2.5 19.5h19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1.4" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-fg">
      <SundialMark />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Sundial</span>
    </span>
  );
}
