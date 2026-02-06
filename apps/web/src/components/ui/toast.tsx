import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { cn } from '~/lib/utils'
import { CheckCircle, AlertCircle, X } from 'lucide-react'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

interface ToastContextValue {
  toast: (message: string, type?: 'success' | 'error') => void
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true)
      setTimeout(() => onDismiss(toast.id), 200)
    }, 3000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg transition-all duration-200',
        isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100',
        toast.type === 'error' && 'border-destructive/50'
      )}
      role="status"
      aria-live="polite"
    >
      {toast.type === 'success' ? (
        <CheckCircle className="h-4 w-4 text-overlap-success shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      )}
      <p className="text-sm">{toast.message}</p>
      <button
        onClick={() => {
          setIsExiting(true)
          setTimeout(() => onDismiss(toast.id), 200)
        }}
        className="ml-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
