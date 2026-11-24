import React from 'react';

interface ZandoLogoProps {
  compact?: boolean;
  className?: string;
}

export const ZandoLogo: React.FC<ZandoLogoProps> = ({compact = false, className = ''}) => {
  return (
    <div
      className={`inline-flex items-center gap-2.5 select-none shrink-0 ${className}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 512 512"
        fill="none"
        aria-hidden="true"
        className="w-8 h-8 rounded-lg shrink-0 shadow-sm pointer-events-none"
      >
        <rect width="512" height="512" rx="112" fill="#0F172A" />
        <rect x="36" y="36" width="440" height="440" rx="88" stroke="#1E293B" strokeWidth="8" />
        <path d="M148 156H364L324 216H212L364 356H148L188 296H300L148 156Z" fill="#10B981" />
        <circle cx="356" cy="156" r="22" fill="#F8FAFC" />
      </svg>
      {!compact && (
        <span className="font-display text-base font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
          ZANDO <span className="text-emerald-600 dark:text-emerald-400">Pro</span>
        </span>
      )}
    </div>
  );
};
