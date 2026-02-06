import { useState, useEffect } from 'react'
import { Bell, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { usePushNotifications } from '~/hooks/use-push-notifications'

const DISMISSED_KEY = 'overlap_notification_prompt_dismissed'

export function NotificationPrompt() {
  const { isSupported, isSubscribed, subscribe } = usePushNotifications()
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isSupported || isSubscribed) return

    const dismissed = localStorage.getItem(DISMISSED_KEY)
    if (dismissed) return

    // Small delay so the dashboard loads first
    const timer = setTimeout(() => setVisible(true), 800)
    return () => clearTimeout(timer)
  }, [isSupported, isSubscribed])

  if (!visible) return null

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString())
    setVisible(false)
  }

  async function handleEnable() {
    setLoading(true)
    await subscribe()
    setLoading(false)
    setVisible(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <button
          onClick={dismiss}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>

          <h2 className="text-lg font-semibold">Enable notifications</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Get notified when another branch overlaps with yours so you can
            coordinate before conflicts happen.
          </p>

          <div className="mt-6 flex w-full gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={dismiss}
            >
              Maybe later
            </Button>
            <Button
              className="flex-1"
              onClick={handleEnable}
              disabled={loading}
            >
              {loading ? 'Enabling...' : 'Enable'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
