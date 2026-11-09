/** Keep each preview's address beside its frame, including frames drawn later.
 * @param {Window} win
 * @param {Document} document
 */
export function frames(win, document) {
  let all = () => [...document.querySelectorAll('iframe[data-frame]')]
  let origin = (frame) => new URL(frame.getAttribute('src')).origin
  let opened = () => {
    for (let app of document.querySelectorAll('[data-app]')) {
      let which = app.querySelector('[name=screen]:checked')?.value
      let address = app.querySelector(
        which ? '[data-address="' + which + '"]' : '[data-address]',
      )
      let open = app.querySelector('[data-open]')
      if (open && address) open.href = address.href
    }
  }
  // Draft shells are sandboxed to an opaque origin; their window and reported
  // URL still belong to the configured app, while live reports prove origin too.
  let ask = (frame) =>
    frame.contentWindow?.postMessage(
      { 'yak-location': true },
      frame.dataset.frame == 'draft' ? '*' : origin(frame),
    )
  win.addEventListener('message', (event) => {
    let href = event.data?.['yak-location']
    if (typeof href != 'string' || !URL.canParse(href)) return
    let frame = all().find((f) =>
      event.source == f.contentWindow &&
      (event.origin == origin(f) ||
        (f.dataset.frame == 'draft' && event.origin == 'null'))
    )
    if (!frame || new URL(href).origin != origin(frame)) return
    let address = frame.parentElement.querySelector(
      '[data-address="' + frame.dataset.frame + '"]',
    )
    if (!address) return
    address.href = href
    address.textContent = href
    opened()
  })
  document.addEventListener('load', (event) => {
    if (event.target?.matches?.('iframe[data-frame]')) ask(event.target)
  }, true)
  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[name=screen]')) opened()
  })
  all().forEach(ask)
  opened()
  return opened
}
