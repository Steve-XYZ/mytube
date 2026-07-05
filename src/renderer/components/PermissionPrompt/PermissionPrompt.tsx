import React from 'react';
import './PermissionPrompt.css';

export interface PermissionRequest {
  id: string;
  origin: string;
  permission: string;
}

const PERMISSION_LABELS: Record<string, string> = {
  media: 'use your camera or microphone',
  'clipboard-read': 'read your clipboard',
  notifications: 'show notifications',
};

interface PermissionPromptProps {
  /** Pending requests; only the first is shown. */
  requests: PermissionRequest[];
  onRespond: (id: string, allow: boolean) => void;
}

/** Per-site permission prompt banner; each answer is remembered per origin. */
export function PermissionPrompt({ requests, onRespond }: PermissionPromptProps) {
  const current = requests[0];
  if (!current) return null;

  const action = PERMISSION_LABELS[current.permission] || `use "${current.permission}"`;

  return (
    <div className="permission-prompt" role="alertdialog" aria-label="Site permission request">
      <p className="permission-prompt-text">
        <strong>{current.origin.replace(/^https?:\/\//, '')}</strong> wants to {action}
      </p>
      <div className="permission-prompt-actions">
        <button className="permission-prompt-btn permission-prompt-allow" onClick={() => onRespond(current.id, true)}>
          Allow
        </button>
        <button className="permission-prompt-btn permission-prompt-block" onClick={() => onRespond(current.id, false)}>
          Block
        </button>
      </div>
    </div>
  );
}
