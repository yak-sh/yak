// The bar a stranger's page wears at a published app (@yaks/platform/visits,
// D-134327): what they change goes to a store of their own, which this browser
// alone reaches, and keeping it is installing the app. Its button opens the
// page that does (`data-yak-keep`, page-script.ts), saying
// `data-yak-keep-says`: "Sign up to keep it" signed out, "Keep it" signed in.
//
// Like the badge (badge.js) it lives in a closed shadow root on an element of
// its own beside <body>, so the page's styles cannot reach in, its own cannot
// leak out, and an app that redraws its whole body leaves it standing. It
// sits in the flow above the body, so it covers nothing the app drew.
;(() => {
  let CSS = `
:host {
  all: initial !important;
  display: block !important;
  position: static !important;
}
@media print {
  :host { display: none !important }
}
p {
  margin: 0;
  padding: 6px calc(12px + env(safe-area-inset-right, 0px)) 6px
    calc(12px + env(safe-area-inset-left, 0px));
  border-bottom: 1px solid #e3d3bf;
  background: #fffcf6;
  color: #45291c;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  text-align: center;
}
small { font-size: 12px; opacity: 0.8 }
a {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #b54a12;
  color: #fff;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
@media (hover: hover) and (pointer: fine) {
  a:hover { background: #9a3e0e }
}
a:focus-visible { outline: 2px solid #b54a12; outline-offset: 2px }
@media (prefers-color-scheme: dark) {
  p { border-color: #4f3c32; background: #2a1f1b; color: #f7ebdc }
  a { background: #ff9a4d; color: #1d1a17 }
  @media (hover: hover) and (pointer: fine) {
    a:hover { background: #ffb071 }
  }
  a:focus-visible { outline-color: #ff9a4d }
}`
  // Read while this script runs: afterwards there is no current script.
  let data = document.currentScript?.dataset
  if (!data?.yakKeep) return
  let host = document.createElement('yaks-visit')
  let root = host.attachShadow({ mode: 'closed' })
  if ('adoptedStyleSheets' in root) {
    let sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    root.adoptedStyleSheets = [sheet]
  } else {
    let style = document.createElement('style')
    style.textContent = CSS
    root.append(style)
  }
  let line = document.createElement('p')
  let more = document.createElement('small')
  more.textContent = 'Another browser, or clearing this one, starts over.'
  let keep = document.createElement('a')
  keep.href = data.yakKeep
  // Keeping is a page of yaks.app's own, never the app's: where the app is
  // shown in a frame, as the home page shows one, it takes the whole window.
  keep.target = '_top'
  keep.textContent = data.yakKeepSays || 'Keep it'
  line.append(
    'Try it. This copy is yours, so nobody else sees what you change, and it is kept for 90 days. ',
    more,
    keep,
  )
  root.append(line)
  let wear = () => document.documentElement.insertBefore(host, document.body)
  if (document.body) wear()
  else document.addEventListener('DOMContentLoaded', wear, { once: true })
})()
