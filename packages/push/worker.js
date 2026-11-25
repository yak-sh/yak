// The service worker that shows what a site pushes (notice.ts): a host
// serves it at its root and registers it (browser.ts `subscribe`).
//
// A push is one of two messages. A notification (`said`): its title, its
// body, its tag, where pressing it opens, its icon and badge, its buttons,
// and how many things wait on its person, which the installed app's icon
// shows. A closing (`closing`) takes away notifications by tag and sets the
// icon's count. Safari receives a visible replacement (`refreshed`).
//
// Every notification push shows something, even one whose words could not
// be read. Pressing a notification opens where it points, in a window already open
// when there is one. Pressing a button that posts sends its form from here
// and closes the notification; when that fails, its notification opens
// instead, so it can be answered there. It handles no fetch, so pages load
// as they would without it.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))

let showing = (said, { silent = false, dismissed = [] } = {}) => {
  let url = said.url || '/'
  return self.registration.showNotification(
    said.title || 'Something new',
    {
      body: silent
        ? said.body ?? ''
        : said.body || 'Open it to see what is new.',
      tag: said.tag,
      renotify: !!said.tag && !silent,
      ...silent
        ? { silent, navigate: new URL(url, self.location.origin).href }
        : {},
      icon: said.icon,
      badge: said.badge,
      actions: (said.actions ?? []).map(({ action, title }) => ({
        action,
        title,
      })),
      data: {
        url,
        actions: said.actions ?? [],
        ...said.check || silent ? { badge: said.badge } : {},
        ...dismissed.length ? { dismissed } : {},
      },
    },
  )
}

let wordsOf = (n) => ({
  title: n.title,
  body: n.body,
  tag: n.tag || undefined,
  icon: n.icon || undefined,
  badge: n.data?.badge,
  url: n.data?.url || n.navigate,
  actions: n.data?.actions,
})

// Explicit close handles WebKit 258922. Safari can enumerate notifications
// today, but a same-tag show can leave the old entry in Notification Center.
let refresh = async (proposed, declarative) => {
  let { handled, empty, check } = proposed.data
  let fallback = wordsOf(proposed)
  let shown = await self.registration.getNotifications()
    .catch((error) => legacy(error, declarative, []))
  let dismissed = new Set([handled])
  for (let n of shown) {
    for (let tag of n.data?.dismissed ?? []) dismissed.add(tag)
    if (n.tag == handled) n.close()
  }
  let others = shown.filter((n) => n.tag && !dismissed.has(n.tag))
  let tags = [...others.map((n) => n.tag), fallback.tag].filter(Boolean)
  let read = check
    ? await handledTags(check, tags).catch((error) =>
      legacy(error, declarative, null)
    )
    : null
  for (let tag of read ?? []) dismissed.add(tag)
  let waiting = read || !empty
    ? others.filter((n) => !dismissed.has(n.tag))
    : []
  let keep = waiting.find((n) => n.tag == fallback.tag) ?? waiting.at(-1)
  let said = keep ? wordsOf(keep) : fallback
  if (!keep && (empty || dismissed.has(fallback.tag))) {
    said = {
      ...fallback,
      tag: undefined,
      title: `${dismissed.size} dismissed`,
      body: '',
    }
  }
  for (let n of shown) {
    if (
      n.tag != handled && (!n.tag || !waiting.includes(n) || n.tag == said.tag)
    ) n.close()
  }
  await showing(said, { silent: true, dismissed: [...dismissed] })
}

// Safari displays the proposed notification on failure. Older browsers
// still need the worker to show the fallback itself.
let legacy = (error, declarative, fallback) => {
  if (declarative) throw error
  return fallback
}

let checked = async (at, tags) => {
  let response = await fetch(at, {
    method: 'POST',
    mode: 'same-origin',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tags),
    signal: AbortSignal.timeout?.(3000),
  })
  if (!response.ok) {
    throw new Error(
      `Could not check handled notifications (${response.status})`,
    )
  }
  return (await response.json()).handled
}

let handledTags = async (at, tags) => {
  let unique = [...new Set(tags)]
  let work = Array.from(
    { length: Math.ceil(unique.length / 50) },
    (_, i) => checked(at, unique.slice(i * 50, i * 50 + 50)),
  )
  return (await Promise.all(work)).flat()
}

let fresh = async (said) => {
  let older = []
  try {
    for (let n of await self.registration.getNotifications()) {
      if (n.tag == said.tag || (!n.tag && n.data?.dismissed)) n.close()
      else if (n.tag) older.push(n)
    }
  } finally {
    await showing(said)
  }
  let handled = new Set(await handledTags(said.check, older.map((n) => n.tag)))
  for (let n of older) if (handled.has(n.tag)) n.close()
}

// WebKit can give concurrent pushes the same view of Notification Center.
let pending = Promise.resolve()
let queued = (run) => {
  let done = pending.then(run)
  pending = done.catch(() => {})
  return done
}

self.addEventListener('push', (event) => {
  let said = {}
  try {
    said = event.data?.json() ?? {}
  } catch {
    said = { body: event.data?.text() ?? '' }
  }
  let proposed = event.notification ??
    (said.web_push == 8030 ? said.notification : null)
  if (proposed && !proposed.data?.handled) return
  let badge = proposed ? event.appBadge ?? proposed.data.count : said.count
  let count = Number.isInteger(badge) ? badge : null
  let badged = count == null || !self.navigator.setAppBadge
    ? null
    : count
    ? self.navigator.setAppBadge(count)
    : self.navigator.clearAppBadge()
  let done = proposed
    ? queued(() => refresh(proposed, !!event.notification))
    : Array.isArray(said.close)
    ? Promise.all(
      said.close.map((tag) =>
        self.registration.getNotifications({ tag }).then((shown) =>
          shown.forEach((n) => n.close())
        )
      ),
    )
    : said.check
    ? queued(() => fresh(said))
    : showing(said)
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
    let here = new URL(url)
    if (here.searchParams.get('_yak_open') == 'push') {
      here.searchParams.delete('_yak_open')
    }
    return open.url == here.href ? open : open.navigate(url.href)
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
