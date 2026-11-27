// An app's page says it ran (views.ts `pageRan`): once, as it starts, it posts
// its path and the site that linked here to its app's `_web/seen`
// (`data-yak-seen`), so a fetch that never runs the page counts no person
// (@yaks/platform/visitor). A browser a program drives says so
// (`navigator.webdriver`) and posts nothing, and a page rendered ahead posts
// once it is shown. Nothing else is sent.
// A block, so its names stay out of the page's other classic scripts.
{
  let to = document.currentScript?.dataset.yakSeen
  let send = () => {
    let body = JSON.stringify({
      path: location.pathname,
      from: document.referrer,
    })
    navigator.sendBeacon?.(to, body) ||
      fetch(to, { method: 'POST', body, keepalive: true }).catch(() => {})
  }
  if (to && !navigator.webdriver) {
    if (document.prerendering) {
      document.addEventListener('prerenderingchange', send, { once: true })
    } else send()
  }
}
