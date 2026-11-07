// The home page's calls to action, counted (funnel.ts `clicked`): a click on
// an element carrying `data-cta` posts that name to /api/click, and nothing
// else. A beacon outlives the page it leaves, so a click that opens /login is
// counted too; where there is no beacon, or the browser will not queue one,
// as an app's in-app browser may not, a keepalive fetch outlives it alike.
addEventListener('click', (e) => {
  let name = e.target.closest?.('[data-cta]')?.dataset.cta
  if (!name || navigator.sendBeacon?.('/api/click', name)) return
  fetch('/api/click', { method: 'POST', body: name, keepalive: true })
    .catch(() => {})
})
