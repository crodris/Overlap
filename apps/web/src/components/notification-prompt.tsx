import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog'
import { usePushNotifications } from '~/hooks/use-push-notifications'

const DISMISSED_KEY = 'overlap_notification_prompt_dismissed'

export function NotificationPrompt() {
  const { isSupported, isSubscribed, subscribe } = usePushNotifications()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isSupported || isSubscribed) return

    const dismissed = localStorage.getItem(DISMISSED_KEY)
    if (dismissed) return

    const timer = setTimeout(() => setOpen(true), 800)
    return () => clearTimeout(timer)
  }, [isSupported, isSubscribed])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString())
    setOpen(false)
  }

  async function handleEnable() {
    setLoading(true)
    await subscribe()
    setLoading(false)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss() }}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle>Enable notifications</DialogTitle>
          <DialogDescription>
            Get notified when another branch overlaps with yours so you can
            coordinate before conflicts happen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            Maybe later
          </Button>
          <Button className="flex-1" onClick={handleEnable} disabled={loading}>
            {loading ? 'Enabling...' : 'Enable'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
