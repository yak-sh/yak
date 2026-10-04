// Browser anchors keep shared addresses and follow the app in place.
import { appRoute, navigate } from '@yaks/browse/nav'
import { localPath } from '@yaks/browse/hosting'
// Internal anchors retain their native shared-link/new-tab address, while a
// plain click follows the app's controlled navigation in this tab.
addEventListener('click', (event) => {
  let ev = event as MouseEvent
  if (
    ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey ||
    ev.altKey || ev.button != 0
  ) return
  let a = (ev.target as Element | null)?.closest?.('a[href]') as
    | HTMLAnchorElement
    | null
  if (!a || a.hasAttribute('download') || a.target && a.target != '_self') {
    return
  }
  let url = new URL(a.href, location.href)
  if (url.origin != location.origin || !appRoute(localPath(url.pathname))) {
    return
  }
  if (
    url.hash && url.pathname + url.search == location.pathname + location.search
  ) return
  ev.preventDefault()
  navigate(localPath(url.pathname) + url.search + url.hash)
})
