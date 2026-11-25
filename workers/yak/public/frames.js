/** Keep where each preview's page has gone on its frame (`data-at`), and Open
 * at the shown one's, including frames drawn later.
 * @param {Window} win
 * @param {Document} document
 * @param {AbortSignal} [signal]
 */
export function frames(win, document, signal) {
  let all = () => [...document.querySelectorAll('iframe[data-frame]')]
  let origin = (frame) => new URL(frame.getAttribute('src')).origin
  let opened = () => {
    for (let app of document.querySelectorAll('[data-app]')) {
      let which = app.querySelector('[name=preview]:checked')?.value
      let frame = app.querySelector(
        which ? 'iframe[data-frame="' + which + '"]' : 'iframe[data-frame]',
      )
      let open = app.querySelector('[data-open]')
      if (open && frame?.dataset.at) open.href = frame.dataset.at
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
    frame.dataset.at = href
    opened()
  }, { signal })
  document.addEventListener('load', (event) => {
    if (event.target?.matches?.('iframe[data-frame]')) ask(event.target)
  }, { capture: true, signal })
  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[name=preview]')) opened()
  }, { signal })
  all().forEach(ask)
  opened()
  return opened
}
