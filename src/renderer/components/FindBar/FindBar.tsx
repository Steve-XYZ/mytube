import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { FindInPageResult } from '../../../shared/types';
import './FindBar.css';

interface FindBarProps {
  visible: boolean;
  onClose: () => void;
}

export function FindBar({ visible, onClose }: FindBarProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FindInPageResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track previous visibility to detect transitions
  const prevVisibleRef = useRef(visible);
  if (visible !== prevVisibleRef.current) {
    prevVisibleRef.current = visible;
    if (!visible) {
      // Becoming hidden — reset search state
      setQuery('');
      setResult(null);
    }
  }

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      window.electronAPI.stopFind();
    }
  }, [visible]);

  useEffect(() => {
    const unsub = window.electronAPI.onFindResult((res: unknown) => {
      setResult(res as FindInPageResult);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (query.length > 0) {
      window.electronAPI.findInPage(query);
    } else {
      window.electronAPI.stopFind();
      setResult(null);
    }
  }, [query]);

  const handleNext = useCallback(() => {
    if (query) window.electronAPI.findNext(query);
  }, [query]);

  const handlePrevious = useCallback(() => {
    if (query) window.electronAPI.findPrevious(query);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrevious();
        } else {
          handleNext();
        }
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleNext, handlePrevious, onClose]
  );

  if (!visible) return null;

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        type="text"
        className="find-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page"
        spellCheck={false}
      />
      {result && query && (
        <span className="find-count">
          {result.matches > 0
            ? `${result.activeMatchOrdinal} / ${result.matches}`
            : 'No results'}
        </span>
      )}
      <button className="find-btn" onClick={handlePrevious} disabled={!query} title="Previous (Shift+Enter)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M3 9l4-4 4 4" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
      <button className="find-btn" onClick={handleNext} disabled={!query} title="Next (Enter)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
      <button className="find-btn find-close" onClick={onClose} title="Close (Esc)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
    </div>
  );
}
