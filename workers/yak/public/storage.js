// localStorage and sessionStorage for a sandboxed app (installed.ts, D-37901).
// An app installed from somebody else's release runs in an opaque origin of
// its own, where the browser's own storage throws. The kernel weaves this
// script into the page's head, ahead of every script of the page's own, with
// the person's saved keys in a JSON block beside it, so reads are synchronous
// from the first line the page runs.
//
// localStorage is the person's own keys in this app's store: a write lands in
// memory at once and is saved in the background, through the same page token
// the rest of the page's requests carry. For a visitor who is not signed in
// it lasts as long as the page, as sessionStorage always does. Nothing here
// runs where the browser's storage works: a trusted app, or the space's own,
// never reaches it.
//
// A classic script, not a module: a module is deferred, and the page's own
// inline scripts would run before it.
;(() => {
  let native = (name) => {
    try {
      return !!globalThis[name]
    } catch {
      return false
    }
  }
  let src = document.currentScript?.src
  if (!src) return
  let door = src.replace(/storage\.js(?:[?#].*)?$/, 'storage')
  let block = document.getElementById('yak-storage')
  let said = {}
  try {
    said = JSON.parse(block?.textContent || '{}')
  } catch { /* nothing saved, then */ }
  // The same ceiling the store holds (graph.ts `STORED`), counted the same
  // way, so a write the store would refuse is refused here as the browser's
  // own would be.
  let MAX = 1024 * 1024

  let area = (keys, saves) => {
    let data = new Map(Object.entries(keys ?? {}))
    let set = {}
    let remove = new Set()
    let clear = false
    let timer = 0
    let send = (keepalive) => {
      clearTimeout(timer)
      timer = 0
      if (!clear && !remove.size && !Object.keys(set).length) return
      let body = JSON.stringify({ set, remove: [...remove], clear })
      set = {}
      remove = new Set()
      clear = false
      fetch(door, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive,
      }).catch(() => {})
    }
    let later = () => {
      if (saves && !timer) timer = setTimeout(() => send(false), 50)
    }
    if (saves) addEventListener('pagehide', () => send(true))
    let size = () => JSON.stringify(Object.fromEntries(data)).length
    let api = {
      get length() {
        return data.size
      },
      key: (i) => [...data.keys()][i] ?? null,
      getItem: (k) => data.has(String(k)) ? data.get(String(k)) : null,
      setItem: (k, v) => {
        k = String(k)
        v = String(v)
        let was = data.get(k)
        data.set(k, v)
        if (size() > MAX) {
          if (was == null) data.delete(k)
          else data.set(k, was)
          throw new DOMException('storage is full', 'QuotaExceededError')
        }
        set[k] = v
        remove.delete(k)
        later()
      },
      removeItem: (k) => {
        k = String(k)
        if (!data.delete(k)) return
        delete set[k]
        remove.add(k)
        later()
      },
      clear: () => {
        data.clear()
        set = {}
        remove = new Set()
        clear = true
        later()
      },
    }
    // `localStorage.theme = 'dark'` and `localStorage.theme` work as they do
    // on the browser's own, and so does `Object.keys(localStorage)`.
    return new Proxy(api, {
      get: (t, k) =>
        typeof k == 'symbol' || k in t ? Reflect.get(t, k) : t.getItem(k),
      set: (t, k, v) => {
        if (typeof k == 'symbol' || k in t) return false
        t.setItem(k, v)
        return true
      },
      deleteProperty: (t, k) => {
        t.removeItem(k)
        return true
      },
      has: (t, k) => k in t || data.has(String(k)),
      ownKeys: () => [...data.keys()],
      getOwnPropertyDescriptor: (_t, k) =>
        data.has(String(k))
          ? {
            value: data.get(String(k)),
            enumerable: true,
            configurable: true,
            writable: true,
          }
          : undefined,
    })
  }
  let give = (name, value) => {
    if (native(name)) return
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      enumerable: true,
    })
  }
  give('localStorage', area(said.keys, !!said.saves))
  give('sessionStorage', area({}, false))
})()
