import { useEffect, useState } from 'react';

interface PlayerAvatarProps {
  src?: string | null;
  name: string;
  className?: string;
  imgClassName?: string;
  fallbackText?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function PlayerAvatar({
  src,
  name,
  className = 'w-11 h-11 rounded-full bg-white/[0.06] overflow-hidden shrink-0 flex items-center justify-center',
  imgClassName = 'w-full h-full object-cover object-top',
  fallbackText,
}: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImg = Boolean(src) && !failed;
  return (
    <div className={className}>
      {showImg ? (
        <img
          src={src!}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={imgClassName}
        />
      ) : (
        <span className="text-xs font-bold text-slate-300 select-none">
          {fallbackText || getInitials(name)}
        </span>
      )}
    </div>
  );
}
