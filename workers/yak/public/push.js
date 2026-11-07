// The service worker that shows what an Operator tells its person as a
// browser notification (operator-alerts.ts `pushed`): each push carries the
// Operator's name, the words, where they open and the notification's tag.
// Clicking one opens their Updates, in a tab already showing it when there
// is one. It handles no fetch, so pages load as they would without it.
self.addEventListener('push', (event) => {
  let said = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(said.title ?? 'yaks.app', {
      body: said.body ?? '',
      tag: said.tag,
      icon: '/icon-192.png',
      data: { url: said.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = event.notification.data?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((tabs) => {
      let open = tabs.find((tab) => tab.url == url)
      return open ? open.focus() : self.clients.openWindow(url)
    }),
  )
})
