// Overlap Service Worker - handles push notifications

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'Overlap', body: event.data.text() }
  }

  const options = {
    body: data.body,
    // PNG, not the SVG favicon: Chrome does not render SVG notification assets.
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    data: { url: data.url },
    tag: data.tag || 'overlap-notification',
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Overlap', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Open new window
      return clients.openWindow(url)
    })
  )
})
