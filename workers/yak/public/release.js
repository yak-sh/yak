// Every HTML page hears releases without changing its client or opening a
// socket of its own. Nothing here reloads until the person presses Reload.
;(() => {
  let script = document.currentScript
  if (!script) return
  let version = Number(script.dataset.version)
  let door = new URL('release', script.src)
  door.searchParams.set('version', String(version))
  let socketDoor = new URL('ws', script.src)
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
