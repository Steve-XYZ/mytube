import React, { useState, useCallback, useRef } from 'react';
import type { TabInfo } from '../../../shared/types';
import './TabBar.css';

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
}

export function TabBar({ tabs, activeTabId, onSwitchTab, onCloseTab, onNewTab, onReorderTabs }: TabBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragRef.current !== null && dropIndex !== null && dragRef.current !== dropIndex) {
      onReorderTabs?.(dragRef.current, dropIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
    dragRef.current = null;
  }, [dropIndex, onReorderTabs]);

  const handleDragLeave = useCallback(() => {
    setDropIndex(null);
  }, []);

  return (
    <div className="tab-bar">
      {/* macOS traffic light spacing */}
      <div className="tab-bar-spacer" />

      <div className="tab-list">
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'tab-active' : ''} ${dragIndex === index ? 'tab-dragging' : ''} ${dropIndex === index && dragIndex !== index ? 'tab-drop-target' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
          >
            {tab.favicon && <img className="tab-favicon" src={tab.favicon} alt="" width={16} height={16} />}
            <span className="tab-title">{tab.title || 'New Tab'}</span>
            {tab.isLoading && <span className="tab-loading" />}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title="Close tab"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <button className="tab-new" onClick={onNewTab} title="New tab">
        +
      </button>
    </div>
  );
}
