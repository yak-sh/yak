// The service worker that shows what a site pushes (notice.ts): a host
// serves it at its root and registers it (browser.ts `subscribe`).
//
// A push is one of two messages. A notification (`said`): its title, its
// body, its tag, where pressing it opens, its icon and badge, its buttons,
// and how many things wait on its person, which the installed app's icon
// shows. A notification with the tag of one already shown replaces it, and
// alerts again. A closing (`closing`): the tags of notifications whose thing
// was read or answered, which are taken away, and the icon's count.
//
// Every notification push shows something, even one whose words could not
// be read: Safari takes back the subscription of a site whose push showed
// nothing, so it is never sent a closing (notice.ts `quietly`). Pressing a
// notification opens where it points, in a window of the site already open
// when there is one. Pressing a button that posts sends its form from here
// and closes the notification; when that fails, its notification opens
// instead, so it can be answered there. It handles no fetch, so pages load
// as they would without it.
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
  let done = Array.isArray(said.close)
    ? Promise.all(
      said.close.map((tag) =>
        self.registration.getNotifications({ tag }).then((shown) =>
          shown.forEach((n) => n.close())
        )
      ),
    )
    : self.registration.showNotification(said.title || 'Something new', {
      body: said.body || 'Open it to see what is new.',
      tag: said.tag,
      renotify: !!said.tag,
      icon: said.icon,
      badge: said.badge,
      actions: (said.actions ?? []).map(({ action, title }) => ({
        action,
        title,
      })),
      data: { url: said.url || '/', actions: said.actions ?? [] },
    })
  event.waitUntil(Promise.all([done, badged?.catch(() => {})]))
})

// Open `to`, in a window of the site already open when there is one.
let opening = (to) => {
  let url = new URL(to ?? '/', self.location.origin)
  return self.clients.matchAll({ type: 'window' }).then(async (windows) => {
    let open = windows.find((w) => new URL(w.url).pathname == url.pathname) ??
      windows[0]
    if (!open) return self.clients.openWindow(url.href)
    // A window this worker does not control can't be moved; it opens anew.
    await open.focus()
    return open.url == url.href ? open : open.navigate(url.href)
      .catch(() => self.clients.openWindow(url.href))
  })
}

// Send a button's form; whether it was taken. A redirect is the answer a
// form gets once it was.
let posting = ({ post, form }) =>
  fetch(post, {
    method: 'POST',
    body: new URLSearchParams(form ?? {}),
    credentials: 'include',
    redirect: 'manual',
  }).then((r) => r.ok || r.type == 'opaqueredirect', () => false)

self.addEventListener('notificationclick', (event) => {
  let { notification, action } = event
  notification.close()
  let data = notification.data ?? {}
  let button = action && data.actions?.find((a) => a.action == action)
  event.waitUntil(
    button?.post
      ? posting(button).then((took) => took || opening(data.url))
      : opening(data.url),
  )
})
