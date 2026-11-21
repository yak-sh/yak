// The home page's own steps, counted from the page (funnel.ts): its visit,
// once the page runs, posts its path to /api/loaded (`loaded`), so a fetch
// that never runs the page is no visitor; and a click on an element carrying
// `data-cta` posts that name to /api/click (`clicked`). Nothing else is sent.
// A beacon outlives the page it leaves, so a click that opens /login is
// counted too; where there is no beacon, or the browser will not queue one,
// as an app's in-app browser may not, a keepalive fetch outlives it alike.
// A block, so its names stay out of the page's other classic scripts.
{
  let send = (to, body) =>
    navigator.sendBeacon?.(to, body) ||
    fetch(to, { method: 'POST', body, keepalive: true }).catch(() => {})
  send('/api/loaded', location.pathname)
  addEventListener('click', (e) => {
    let name = e.target.closest?.('[data-cta]')?.dataset.cta
    if (name) send('/api/click', name)
  })
}
