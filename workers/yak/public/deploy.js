// A dashboard page moves onto the deploy serving yaks.app now, rather than
// running the code it was drawn with until someone reloads it (T-147003).
//
// The page wears the deploy that drew it (pages.ts `documented`), and asks
// /login/who which deploy answers now: as it comes back into view, at most
// once a minute; as the network comes back; and as its socket opens again
// (`yak-reconnect`, the Operator's chat), which every deploy makes it do. A
// newer deploy is moved onto by reloading, at a calm moment: no key, pointer
// or scroll for a few seconds, no words being composed or selected, no file
// chosen, no dialog open, and nothing on the page busy (an Operator's turn,
// `data-pending`, or a send, `aria-busy`). A hidden page is calm whenever
// nothing on it is busy.
//
// The reload keeps what the person had: the window's scroll, or its bottom
// where they were following it down; the entries they had open; the field they
// were in and where in it; and each value they changed from what the page
// drew, put back as if typed. A draft is kept on the device and in the store
// as well (@yaks/draft). The browser shows the old page until the new one
// paints, so nothing flashes.
{
  let script = document.currentScript
  let mine = script?.dataset.deploy
  let drawn = Date.parse(script?.dataset.deployAt ?? '')
  let KEY = `yak-deploy:${location.pathname}`
  // The deploy this tab last moved for: a page an older isolate drew again is
  // not moved twice for one deploy.
  let FOR = 'yak-deploy'
  let QUIET = 3000
  let SKIP = [
    'password',
    'file',
    'hidden',
    'submit',
    'button',
    'reset',
    'image',
  ]
  // Each element by its id or name, and its place among those sharing it.
  let keyed = (els, name) => {
    let seen = {}
    return els.map((el) => {
      let key = name(el)
      seen[key] = (seen[key] ?? 0) + 1
      return [`${key}:${seen[key]}`, el]
    })
  }
  let fields = () =>
    keyed(
      [...document.querySelectorAll('input, textarea, select')]
        .filter((el) => !SKIP.includes(el.type)),
      (el) => el.id || el.name || el.localName,
    )
  let entries = () =>
    keyed(
      [...document.querySelectorAll('details')],
      (d) => d.id || d.querySelector('summary')?.textContent || '',
    )
  let checkable = (el) => el.type == 'checkbox' || el.type == 'radio'
  let changed = (el) =>
    checkable(el)
      ? el.checked != el.defaultChecked
      : el.localName == 'select'
      ? [...el.options].some((o) => o.selected != o.defaultSelected)
      : el.value != el.defaultValue

  let kept = (() => {
    try {
      let value = sessionStorage.getItem(KEY)
      sessionStorage.removeItem(KEY)
      return value && JSON.parse(value)
    } catch {
      return null
    }
  })()
  if (kept) {
    let open = new Map(kept.open)
    for (let [key, d] of entries()) if (open.has(key)) d.open = open.get(key)
    let typed = new Map(kept.fields.map(([key, ...was]) => [key, was]))
    for (let [key, el] of fields()) {
      if (!typed.has(key)) continue
      let [value, checked] = typed.get(key)
      if (checkable(el)) el.checked = checked
      else el.value = value
      el.dispatchEvent(
        new Event(checkable(el) ? 'change' : 'input', {
          bubbles: true,
        }),
      )
    }
    let [focus, start, end] = kept.focus ?? []
    let field = fields().find(([key]) => key == focus)?.[1]
    if (field) {
      field.focus({ preventScroll: true })
      if (start != null) field.setSelectionRange?.(start, end)
    }
    let scroll = () =>
      scrollTo(
        kept.x,
        kept.bottom ? document.documentElement.scrollHeight : kept.y,
      )
    scroll()
    if (document.readyState == 'complete') history.scrollRestoration = 'auto'
    else {
      addEventListener('load', () => {
        scroll()
        history.scrollRestoration = 'auto'
      }, { once: true })
    }
  }

  let last = Date.now(), composing = false
  let stir = () => last = Date.now()
  for (let kind of ['keydown', 'input', 'pointerdown', 'wheel', 'touchstart']) {
    addEventListener(kind, stir, { capture: true, passive: true })
  }
  addEventListener('scroll', stir, { capture: true, passive: true })
  addEventListener('compositionstart', () => composing = true, true)
  addEventListener('compositionend', () => (composing = false, stir()), true)

  let busy = () =>
    composing ||
    !!document.querySelector(
      '[data-pending], [aria-busy="true"], dialog[open]',
    ) ||
    [...document.querySelectorAll('input[type=file]')].some((f) =>
      f.files?.length
    ) ||
    !!String(globalThis.getSelection?.() ?? '')

  let target, timer
  let move = () => {
    let active = fields().find(([, el]) => el == document.activeElement)
    let root = document.documentElement
    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          x: scrollX,
          y: scrollY,
          bottom: scrollY > 0 &&
            innerHeight + scrollY >= root.scrollHeight - 40,
          open: entries().map(([key, d]) => [key, d.open]),
          fields: fields().filter(([, el]) => changed(el))
            .map(([key, el]) => [key, el.value, el.checked]),
          focus: active && [
            active[0],
            active[1].selectionStart,
            active[1].selectionEnd,
          ],
        }),
      )
      sessionStorage.setItem(FOR, target)
    } catch {
      // Nowhere to keep what was typed: the page stays on the code it has.
      return
    }
    history.scrollRestoration = 'manual'
    location.reload()
  }
  // Moves once the page is calm, looking again as soon as it may be.
  let settle = () => {
    clearTimeout(timer)
    if (!target) return
    let quiet = document.visibilityState == 'hidden'
      ? 0
      : QUIET - (Date.now() - last)
    if (busy()) timer = setTimeout(settle, 1000)
    else if (quiet > 0) timer = setTimeout(settle, quiet)
    else move()
  }

  let asking = false
  let ask = async () => {
    if (!mine || asking) return
    asking = true
    try {
      let response = await fetch('/login/who', { cache: 'no-store' })
        .catch(() => null)
      if (!response?.ok) return
      let now = (await response.json()).deploy
      let moved = (() => {
        try {
          return sessionStorage.getItem(FOR)
        } catch {
          return null
        }
      })()
      if (
        now?.id && now.id != mine && now.id != moved &&
        Date.parse(now.at) > drawn
      ) {
        target = now.id
        settle()
      }
    } finally {
      asking = false
    }
  }

  let seen = Date.now()
  let returned = () => {
    if (document.visibilityState != 'visible') return settle()
    if (Date.now() - seen < 60000) return
    seen = Date.now()
    ask()
  }
  document.addEventListener('visibilitychange', returned)
  addEventListener('pageshow', (e) => e.persisted && returned())
  addEventListener('online', ask)
  addEventListener('yak-reconnect', ask)
}
