// Where the chat page stands in its conversation (operator-page.ts
// `chatScript`). It opens at the newest entry, or at the entry its address
// names (`#row-…`), and stays at the newest while anything on the page grows
// or shrinks (a picture loading, the aside, a read drawing the conversation
// again), until the person scrolls up to read. It then stays where they are,
// and `jump`, shown while they are away from the newest, takes them back.
//
// The browser restores no old position over it. An address naming something
// outside the conversation (the side's `#menu`, the app's `#app` on a phone)
// is a layer over it: the place under it is kept while it is open and put back
// as it closes, which a link to `#` would otherwise do by sending the page to
// its top. Served as it is written, like redraw.js.

/**
 * @param {Window & typeof globalThis} win
 * @param {Element} conversation
 * @param {HTMLElement | null} jump
 */
export function follow(win, conversation, jump) {
  let doc = conversation.ownerDocument
  let root = doc.documentElement
  let near = () =>
    !win.innerHeight ||
    win.innerHeight + win.scrollY >= root.scrollHeight - 120
  let named = () => {
    let id = decodeURIComponent(win.location.hash?.slice(1) ?? '')
    return id ? doc.getElementById(id) : null
  }
  let entry = () => {
    let at = named()
    return at && conversation.contains(at) ? at : null
  }
  let over = () => {
    let at = named()
    return !!at && !conversation.contains(at)
  }
  // Whether the page stays at the newest, and where the person last was.
  let pinned = true, y = 0
  let shown = () => {
    if (jump) jump.hidden = pinned
  }
  let newest = () => {
    win.scrollTo(0, root.scrollHeight)
    y = win.scrollY
  }
  let opened = () => {
    let at = entry()
    pinned = !at
    if (at) at.scrollIntoView({ block: 'center' }), y = win.scrollY
    else newest()
    shown()
  }
  let back = () => {
    if (pinned) newest()
    else win.scrollTo(0, y)
  }

  if (win.history) win.history.scrollRestoration = 'manual'
  opened()
  // Scrolling up is the person reading; reaching the newest follows it again.
  win.addEventListener('scroll', () => {
    if (over()) return
    let now = win.scrollY
    if (near()) pinned = true
    else if (now < y) pinned = false
    y = now
    shown()
  }, { passive: true })
  let grown = () => {
    if (pinned && !over()) newest()
  }
  if (win.ResizeObserver) new win.ResizeObserver(grown).observe(doc.body)
  win.addEventListener('resize', grown)
  win.addEventListener('hashchange', () => {
    if (entry()) opened()
    else if (!over()) back()
  })
  // A layer's close (`href="#"`) takes the layer off where the person was.
  doc.addEventListener('click', (e) => {
    let link = /** @type {Element} */ (e.target).closest?.('a[href="#"]')
    if (!link || !over()) return
    e.preventDefault()
    win.location.hash = ''
    back()
  })
  let toNewest = () => {
    pinned = true
    newest()
    shown()
  }
  jump?.addEventListener('click', toNewest)
  return { newest: toNewest }
}
