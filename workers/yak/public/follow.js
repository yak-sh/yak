// Where the chat page's conversation stands under a layer over it
// (operator-page.ts `chatScript`). An address naming something outside the
// conversation (the side's `#menu`, the app's `#app` on a phone) is a layer
// over it: the place under it is kept while it is open and put back as it
// closes, which a link to `#` would otherwise do by sending the page to its
// top. Staying at the newest line until the person scrolls up is the
// conversation's own (@yaks/ux `Conversation`), and the browser restores no
// old position over either. Served as it is written.

/**
 * @param {Window & typeof globalThis} win
 * @param {Element} conversation
 * @param {HTMLElement | null} pane
 * @param {AbortSignal} [signal]
 */
export function follow(win, conversation, pane, signal) {
  let doc = conversation.ownerDocument
  let named = () => {
    let id = decodeURIComponent(win.location.hash?.slice(1) ?? '')
    return id ? doc.getElementById(id) : null
  }
  let over = () => {
    let at = named()
    return !!at && !conversation.contains(at)
  }
  if (win.history) {
    let was = win.history.scrollRestoration
    win.history.scrollRestoration = 'manual'
    signal?.addEventListener('abort', () => {
      win.history.scrollRestoration = was
    }, { once: true })
  }
  if (!pane) return
  // A conversation standing hidden (another view of its page showing) keeps
  // nothing of the pane it shares, and puts nothing back.
  let hidden = () => !!conversation.closest('[hidden]')
  // Where the person was, kept while nothing is over the conversation.
  let y = pane.scrollTop
  pane.addEventListener('scroll', () => {
    if (!over() && !hidden()) y = pane.scrollTop
  }, { passive: true, signal })
  let back = () => {
    if (!hidden()) pane.scrollTop = y
  }
  win.addEventListener('hashchange', () => {
    if (!named()) back()
  }, { signal })
  // A layer's close (`href="#"`) takes the layer off where the person was.
  doc.addEventListener('click', (e) => {
    let link = /** @type {Element} */ (e.target).closest?.('a[href="#"]')
    if (!link || !over()) return
    e.preventDefault()
    win.location.replace('#')
    back()
  }, { signal })
}
