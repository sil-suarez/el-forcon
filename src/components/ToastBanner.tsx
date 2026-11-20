export interface ToastMessage {
  type: 'success' | 'error';
  text: string;
}

interface ToastBannerProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export function ToastBanner({ toast, onClose }: ToastBannerProps) {
  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`toast-banner ${
        toast.type === 'success' ? 'toast-success' : 'toast-error'
      }`}
    >
      <span>{toast.text}</span>
      <button type="button" className="toast-close" onClick={onClose}>
        Cerrar
      </button>
    </div>
  );
}
