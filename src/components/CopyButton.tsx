import { useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Check, Copy } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Copy-to-clipboard button with transient copied/failed feedback.
 * Shared by the post-processing tabs and the publish checklist.
 */
export function CopyButton({
  text,
  ariaLabel,
  className,
}: {
  text: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
        copied
          ? 'bg-violet-50 text-violet-600'
          : failed
          ? 'bg-red-50 text-red-500'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
        className
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : failed ? 'Failed' : 'Copy'}
    </button>
  );
}
