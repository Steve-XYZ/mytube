import React, { useEffect, useState, useCallback } from 'react';
import './Toast.css';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

interface ToastContainerProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ messages, onDismiss }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ message, onDismiss }: { message: ToastMessage; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(message.id), 300);
    }, 5000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(message.id), 300);
  }, [message.id, onDismiss]);

  return (
    <div className={`toast toast-${message.type} ${exiting ? 'toast-exit' : ''}`}>
      <span className="toast-icon">
        {message.type === 'error' && '!'}
        {message.type === 'success' && '\u2713'}
        {message.type === 'info' && 'i'}
      </span>
      <span className="toast-text">{message.text}</span>
      <button className="toast-close" onClick={handleDismiss}>&times;</button>
    </div>
  );
}

// Hook for managing toasts
let toastCounter = 0;

export function useToasts() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = `toast-${++toastCounter}`;
    setMessages((prev) => [...prev, { id, type, text }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return { messages, addToast, dismissToast };
}
