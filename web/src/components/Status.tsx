import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<Tone, string> = {
  neutral: '•',
  info: 'i',
  success: '✓',
  warning: '!',
  error: '×',
};

/**
 * Inline status message. Uses role="alert" for errors and role="status" for
 * the rest so screen readers hear the update without a focus move. The icon
 * is a redundant cue so tone is never carried by color alone.
 */
export function StatusMessage({ tone, children, id }: { tone: Tone; children: ReactNode; id?: string }) {
  return (
    <p className={`status status-${tone}`} role={tone === 'error' ? 'alert' : 'status'} id={id}>
      <span className="status-icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <span className="status-text">{children}</span>
    </p>
  );
}

/** Small labelled pill, e.g. "Ready" / "Not ready". */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
