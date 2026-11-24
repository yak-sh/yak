/** A form the browser sends shows it is sending in the frame of the press:
 * the button pressed waits (`aria-busy`) until the next page replaces this
 * one. A send a script took over (`preventDefault`), one into another tab and
 * a dialog's close are the page's own to show. A page restored by Back is
 * drawn as it was before the send.
 * @module
 */

type Window = typeof globalThis

let self = (at: string | null | undefined) => !at || at.toLowerCase() == '_self'

/** The element that waits on `e`'s send, or none where the page stays. */
export let waiting = (e: SubmitEvent): Element | undefined => {
  let form = e.target as HTMLFormElement | null
  if (!form) return
  let by = e.submitter
  let target = by?.getAttribute('formtarget') ?? form.getAttribute('target')
  let method = by?.getAttribute('formmethod') ?? form.getAttribute('method')
  if (!self(target) || method?.toLowerCase() == 'dialog') return
  return by ?? form
}

/** Show each native send of `win`'s forms as pending. */
export let sending = (win: Window): void => {
  let marked = new Set<Element>()
  win.document.addEventListener('submit', (e) => {
    let at = waiting(e as SubmitEvent)
    if (!at) return
    // Every listener has had its say by the frame the send is drawn in.
    win.requestAnimationFrame(() => {
      if (e.defaultPrevented) return
      at.setAttribute('aria-busy', 'true')
      marked.add(at)
    })
  })
  win.addEventListener('pageshow', (e) => {
    if (!(e as PageTransitionEvent).persisted) return
    for (let at of marked) at.removeAttribute('aria-busy')
    marked.clear()
  })
}

if (typeof document != 'undefined') sending(globalThis)
