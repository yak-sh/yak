import { interactions } from '@yaks/timing/interaction-browser'
import { CHECK } from './bots.ts'
import { pageKind, targetKind } from './interaction.ts'

let view = typeof document == 'undefined' ? null : document.defaultView
if (view && view.top == view) {
  let endpoint = document.querySelector('[data-yak-interaction]')
    ?.getAttribute('data-yak-interaction')
  let test = () =>
    navigator.webdriver ||
    new URLSearchParams(location.search).get('utm_source') == CHECK
  let checked = test()
  interactions(view, {
    page: (url) => pageKind(url.pathname, url.searchParams.has('app')),
    target: targetKind,
    send: (batch) => {
      if (!endpoint || checked || test()) return
      let body = JSON.stringify(batch)
      if (navigator.sendBeacon?.(endpoint, body)) return
      void fetch(endpoint, {
        method: 'POST',
        body,
        keepalive: true,
      }).catch(() => {/* telemetry can be lost when the document closes */})
    },
  })
}
