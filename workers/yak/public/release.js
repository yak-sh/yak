// Every HTML page hears releases without changing its client or opening a
// socket of its own. Nothing here reloads until the person presses Reload.
// Woven inline into the page beside the reporter (page-script.ts).
//
// A page from an app's preview link (preview.ts, `data-yak-draft` naming the
// link) follows the app's draft instead: it opens a socket of its own, and
// takes each write the link's store tells it of (`{"draft":…}`), across
// deploys; a release comes as one naming no files, and reloads the page to
// show what was released. A cancelable `yak-draft` event
// goes first, so a page can take the write itself (@yaks/preact/host takes
// a write of its views module so) and still reload if it cannot; else a
// write of only stylesheets the page links swaps each in place, and any other
// reloads the page, keeping the window's scroll and the values typed into its
// fields. A framed page tells its frame each write first (`{"yak-draft":…}`),
// so a TV showing it (screen.ts) can say what just changed; to any origin,
// since only the app's space and yaks.app may frame it (cache.ts `sealed`).
;(() => {
  let script = document.currentScript
  if (!script) return
  let version = Number(script.dataset.yakVersion)
  let at = new URL(script.dataset.yakAt, location.href)
  let following = (link) => {
    // What a reload keeps, in sessionStorage, or in the window's name where a
    // sandboxed page has no storage: both outlive a reload of the tab.
    let KEY = `yak-draft:${at.pathname}`
    let put = (value) => {
      try {
        sessionStorage.setItem(KEY, value)
      } catch {
        name = KEY + value
      }
    }
    let take = () => {
      let value = null
      try {
        value = sessionStorage.getItem(KEY)
        sessionStorage.removeItem(KEY)
      } catch { /* the window's name holds it instead */ }
      if (value == null && name.startsWith(KEY)) {
        value = name.slice(KEY.length)
        name = ''
      }
      try {
        return value && JSON.parse(value)
      } catch {
        return null
      }
    }
    let SKIP = ['password', 'file', 'hidden', 'submit', 'button', 'reset']
    // Each field by its id or name, and its place among those sharing it.
    let fields = () => {
      let seen = {}
      return [...document.querySelectorAll('input, textarea, select')]
        .filter((el) => !SKIP.includes(el.type))
        .map((el) => {
          let key = el.id || el.name || el.tagName
          seen[key] = (seen[key] ?? 0) + 1
          return [`${key}:${seen[key]}`, el]
        })
    }
    let reload = () => {
      put(JSON.stringify({
        x: scrollX,
        y: scrollY,
        fields: fields().map(([key, el]) => [key, el.value, el.checked]),
      }))
      location.reload()
    }
    let kept = take()
    if (kept) {
      let restore = () => {
        let typed = new Map(kept.fields.map(([key, ...v]) => [key, v]))
        for (let [key, el] of fields()) {
          if (!typed.has(key)) continue
          let [value, checked] = typed.get(key)
          if (el.type == 'checkbox' || el.type == 'radio') el.checked = checked
          else el.value = value
        }
        scrollTo(kept.x, kept.y)
      }
      if (document.readyState == 'complete') restore()
      else addEventListener('load', restore, { once: true })
    }
    let path = (url) => new URL(url, document.baseURI).pathname
    // The link each stylesheet in `files` names, the newest where a swap is
    // still loading; none unless the page links every one.
    let sheets = (files) => {
      let links = [...document.querySelectorAll('link[rel~="stylesheet"]')]
      let found = files.map((file) =>
        file.sha && /\.css$/i.test(file.path)
          ? links.filter((link) =>
            path(link.href) == path(new URL(file.path, at))
          ).at(-1)
          : undefined
      )
      return found.length && found.every(Boolean) ? found : null
    }
    let swap = (link, sha) => {
      let next = link.cloneNode()
      let url = new URL(link.href, document.baseURI)
      url.searchParams.set('yak-draft', sha)
      next.href = String(url)
      next.addEventListener('load', () => link.remove(), { once: true })
      link.after(next)
    }
    let framed = globalThis.parent != null && globalThis.parent != globalThis
    let took = (news) => {
      if (news.link != link || !Array.isArray(news.files)) return
      if (framed) {
        globalThis.parent.postMessage({
          'yak-draft': {
            files: news.files.map((f) => ({ path: f.path, sha: f.sha })),
            at: news.at,
          },
        }, '*')
      }
      // Each file with the address it serves at; a page that took the write
      // and could not use it calls `reload`, the one this page would have had.
      let files = news.files.map((file) => ({
        ...file,
        url: String(new URL(file.path, at)),
        ...(file.entries
          ? {
            entries: file.entries.map((entry) => String(new URL(entry, at))),
          }
          : {}),
      }))
      let event = new CustomEvent('yak-draft', {
        detail: { ...news, files },
        cancelable: true,
      })
      event.reload = reload
      if (!dispatchEvent(event)) return
      let links = sheets(news.files)
      if (links) links.forEach((link, i) => swap(link, news.files[i].sha))
      else reload()
    }
    let door = new URL('api/ws', at)
    door.protocol = door.protocol == 'https:' ? 'wss:' : 'ws:'
    let wait = 1000
    let opened = false
    let connect = () => {
      let socket = new WebSocket(door)
      socket.addEventListener('open', () => {
        // A socket that dropped may have missed a write; the page reloads
        // to show the draft as it stands.
        if (opened) reload()
        opened = true
        wait = 1000
      })
      socket.addEventListener('message', ({ data }) => {
        if (typeof data != 'string' || !data.startsWith('{"draft":')) return
        try {
          took(JSON.parse(data).draft)
        } catch { /* a malformed packet is not a write */ }
      })
      socket.addEventListener('close', () => {
        setTimeout(connect, wait)
        wait = Math.min(wait * 2, 30000)
      })
    }
    connect()
  }
  if (script.dataset.yakDraft) return following(script.dataset.yakDraft)
  let door = new URL('api/release', at)
  door.searchParams.set('version', String(version))
  let socketDoor = new URL('api/ws', at)
  let latest = version
  let busy = false
  let again = false
  let visibleAt = -Infinity
  let box
  let dismissed = (n) => {
    try {
      return sessionStorage.getItem(`yak-release:${door.pathname}:${n}`) ==
        'dismissed'
    } catch {
      return false
    }
  }
  let ready = (fn) => {
    if (document.body) fn()
    else document.addEventListener('DOMContentLoaded', fn, { once: true })
  }
  let notice = ({ version: n, reload }) => {
    if (reload == 'optional' && dismissed(n)) return
    ready(() => {
      if (n != latest) return
      box?.remove()
      box = document.createElement('div')
      box.id = 'yak-release'
      box.setAttribute('role', 'status')
      // In document flow, never an overlay: input stays reachable and copyable.
      let dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches
      box.style.cssText =
        'display:flex;align-items:center;gap:1rem;flex-wrap:wrap;' +
        'padding:.7rem 1rem;box-sizing:border-box;' +
        "font:500 .95rem/1.5 'Nunito',system-ui,sans-serif;" +
        (dark
          ? 'background:#2b231f;color:#f1e6d8'
          : 'background:#fdf7ee;color:#523828')
      let words = document.createElement('span')
      words.textContent = reload == 'required'
        ? 'This app has changed. Reload to keep using it'
        : 'A new version of this app is out'
      let button = (text, press) => {
        let b = document.createElement('button')
        b.type = 'button'
        b.textContent = text
        b.style.cssText = 'font:inherit;color:inherit;background:transparent;' +
          'border:1px solid currentColor;border-radius:.4rem;padding:.2rem .6rem;cursor:pointer'
        b.addEventListener('click', press)
        return b
      }
      box.append(words, button('Reload', () => location.reload()))
      if (reload == 'optional') {
        box.append(button('Dismiss', () => {
          try {
            sessionStorage.setItem(
              `yak-release:${door.pathname}:${n}`,
              'dismissed',
            )
          } catch { /* a tab without storage can still dismiss this notice */ }
          box.remove()
        }))
      }
      document.body.prepend(box)
    })
  }
  let check = async () => {
    if (busy) {
      again = true
      return
    }
    busy = true
    try {
      let res = await fetch(door, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) return
      let release = await res.json()
      if (!Number.isSafeInteger(release.version) || release.version <= latest) {
        return
      }
      latest = release.version
      if (release.reload != 'optional' && release.reload != 'required') return
      let event = new CustomEvent('yak-release', {
        detail: release,
        cancelable: true,
      })
      if (dispatchEvent(event)) notice(release)
    } catch {
      /* offline pages check again on their next return or socket open */
    } finally {
      busy = false
      if (again) {
        again = false
        check()
      }
    }
  }
  let Native = globalThis.WebSocket
  if (Native) {
    globalThis.WebSocket = new Proxy(Native, {
      construct(target, args, next) {
        let socket = Reflect.construct(target, args, next)
        let url = new URL(args[0], location.href)
        if (
          url.host == socketDoor.host && url.pathname == socketDoor.pathname &&
          url.protocol == (socketDoor.protocol == 'https:' ? 'wss:' : 'ws:')
        ) {
          socket.addEventListener('open', check)
          socket.addEventListener('message', ({ data }) => {
            // Position relays only pay this prefix check, not JSON parsing.
            if (typeof data != 'string' || !data.startsWith('{"release":')) {
              return
            }
            try {
              let n = JSON.parse(data).release?.version
              if (Number.isSafeInteger(n) && n > latest) check()
            } catch { /* a malformed packet is not a release */ }
          })
        }
        return socket
      },
    })
  }
  let returned = () => {
    if (document.visibilityState != 'visible') return
    let now = Date.now()
    if (now - visibleAt < 60000) return
    visibleAt = now
    check()
  }
  document.addEventListener('visibilitychange', returned)
  addEventListener('pageshow', (event) => {
    if (event.persisted) returned()
  })
})()
