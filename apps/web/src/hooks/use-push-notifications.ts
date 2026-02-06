import { useState, useEffect, useCallback } from 'react'
import { api } from '~/lib/api'
import { useAuth } from './use-auth'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushNotifications() {
  const { isAuthenticated } = useAuth()
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY
    setIsSupported(supported)

    if (supported && isAuthenticated) {
      checkSubscription()
    }
  }, [isAuthenticated])

  async function checkSubscription() {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      if (registration) {
        const subscription = await registration.pushManager.getSubscription()
        setIsSubscribed(!!subscription)
      }
    } catch {
      // Ignore errors during check
    }
  }

  const subscribe = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })

      const json = subscription.toJSON()
      await api.subscribePush({
        endpoint: json.endpoint!,
        keys: {
          p256dh: json.keys!.p256dh!,
          auth: json.keys!.auth!,
        },
      })

      setIsSubscribed(true)
    } catch (err) {
      console.error('Failed to subscribe to push:', err)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      if (!registration) return

      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return

      await api.unsubscribePush(subscription.endpoint)
      await subscription.unsubscribe()

      setIsSubscribed(false)
    } catch (err) {
      console.error('Failed to unsubscribe from push:', err)
    }
  }, [])

  return { isSupported, isSubscribed, subscribe, unsubscribe }
}
