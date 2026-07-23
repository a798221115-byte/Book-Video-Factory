"use client";

import { useCallback, useState } from "react";

export type ToastTone = "success" | "error" | "info";

export type ToastMessage = {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
};

type ToastInput = {
  tone?: ToastTone;
  title: string;
  detail?: string;
};

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((toast: ToastInput) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [
      ...current.slice(-3),
      { id, tone: toast.tone || "info", title: toast.title, detail: toast.detail },
    ]);
    window.setTimeout(() => dismissToast(id), toast.tone === "error" ? 6000 : 3600);
  }, [dismissToast]);

  return { toasts, notify, dismissToast };
}

export default function ToastHost({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast-card ${toast.tone}`} key={toast.id}>
          <div>
            <strong>{toast.title}</strong>
            {toast.detail && <p>{toast.detail}</p>}
          </div>
          <button type="button" aria-label="关闭通知" onClick={() => onDismiss(toast.id)}>&times;</button>
        </div>
      ))}
    </div>
  );
}
