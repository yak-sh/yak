// The service worker that shows what an Operator tells its person as a
// notification (operator-alerts.ts `pushed`): each push carries the
// Operator's name, the alert in a line, where it opens, the notification's
// tag, and how many things need them, which the installed icon shows. Every
// push shows a notification, even one whose words could not be read: Apple
// takes back the permission of a page whose push showed nothing. Pressing
// one opens where it points (the conversation at what it is about), in a
// window of the page already open when there is one. It handles no fetch, so
// pages load as they would without it.
self.addEventListener('push', (event) => {
  let said = {}
  try {
    said = event.data?.json() ?? {}
  } catch {
    said = { body: event.data?.text() ?? '' }
  }
  let count = Number.isInteger(said.count) ? said.count : null
  let badged = count == null || !self.navigator.setAppBadge
    ? null
    : count
    ? self.navigator.setAppBadge(count)
    : self.navigator.clearAppBadge()
  event.waitUntil(Promise.all([
    self.registration.showNotification(said.title || 'yaks.app', {
      body: said.body || 'Something new from your Operator.',
      tag: said.tag,
      icon: '/icon-192.png',
      data: { url: said.url || '/' },
    }),
    badged?.catch(() => {}),
  ]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = new URL(event.notification.data?.url ?? '/', self.location.origin)
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(async (windows) => {
      let open = windows.find((w) => new URL(w.url).pathname == url.pathname) ??
        windows[0]
      if (!open) return self.clients.openWindow(url.href)
      // A window this worker does not control can't be moved; it opens anew.
      await open.focus()
      return open.url == url.href ? open : open.navigate(url.href)
        .catch(() => self.clients.openWindow(url.href))
    }),
  )
})
