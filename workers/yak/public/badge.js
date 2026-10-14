// The badge an app wears while its space is on the free plan: "Made with
// yaks.app" in a corner, opening yaks.app in a new tab so the page and what
// was typed into it stay put. Woven inline beside the reporter, and only into
// a free space's pages (page-script.ts), so a kept version or a published
// release wears it without its files changing, and a space on the Plus plan
// sheds it on its next load.
//
// It lives in a closed shadow root on an element of its own, beside <body>
// rather than in it: the page's styles cannot reach in (the host's rules are
// `!important` inside its shadow, which outranks the page's own), its styles
// cannot leak out, and an app that redraws its whole body leaves it standing.
// The sheet is a constructed one, which a page's style-src policy does not
// govern.
//
// It never covers what the app drew to be pressed, and never moves the app's
// layout. On a page that scrolls it sticks to the bottom right corner from the
// end of the document, so what passes under it scrolls on and the last of the
// page comes to rest above it, not beneath it; a bar the app pins to the
// bottom lifts it above the bar. On a page that does not scroll it is fixed
// in the first corner with no control under it. Where nothing is free it
// drops into the page's flow after the body, the way the release notice does
// (release.js).
;(() => {
  let CSS = `
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  margin: 0 !important;
  pointer-events: none !important;
}
:host([at=br]), :host([at=bl]) {
  bottom: calc(8px + env(safe-area-inset-bottom, 0px)) !important;
}
:host([at=tr]), :host([at=tl]) {
  top: calc(8px + env(safe-area-inset-top, 0px)) !important;
}
:host([at=br]), :host([at=tr]) {
  right: calc(8px + env(safe-area-inset-right, 0px)) !important;
}
:host([at=bl]), :host([at=tl]) {
  left: calc(8px + env(safe-area-inset-left, 0px)) !important;
}
:host([at=end]), :host([at=flow]) {
  position: static !important;
  display: flex !important;
  justify-content: flex-end !important;
  padding: 8px calc(8px + env(safe-area-inset-right, 0px))
    calc(8px + env(safe-area-inset-bottom, 0px)) 8px !important;
}
:host([at=end]) {
  position: sticky !important;
  bottom: 0 !important;
}
@media print {
  :host { display: none !important }
}
a {
  display: block;
  padding: 5px 9px;
  border: 1px solid #e3d3bf;
  border-radius: 999px;
  background: #fffbf5;
  color: #523828;
  box-shadow: 0 1px 3px rgb(82 56 40 / 0.18);
  font: 500 11px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: 0.01em;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
a:hover { border-color: #c9b19c }
a:focus-visible { outline: 2px solid #4c773e; outline-offset: 2px }
b { font-weight: 800 }
@media (prefers-color-scheme: dark) {
  a {
    border-color: #4d3d34;
    background: #2b231f;
    color: #f1e6d8;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
  }
  a:hover { border-color: #785b47 }
  a:focus-visible { outline-color: #a7c080 }
}`
  // What a person presses or types into, as markup says it; a `cursor:
  // pointer` the app set says the same of anything else.
  let PRESSED = 'a[href],button,input,select,textarea,label,summary,' +
    '[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],' +
    '[role=switch],[contenteditable],[tabindex]'
  let CORNERS = ['br', 'bl', 'tr', 'tl']

  let host = document.createElement('yaks-badge')
  let root = host.attachShadow({ mode: 'closed' })
  // Two sheets: the look, and how high the badge rides at the end of a
  // scrolling page, rewritten as the app's bottom bar comes and goes.
  let sheets = [CSS, ''].map((text) => {
    if ('adoptedStyleSheets' in root) {
      let sheet = new CSSStyleSheet()
      sheet.replaceSync(text)
      return { sheet, put: (t) => sheet.replaceSync(t) }
    }
    let style = document.createElement('style')
    style.textContent = text
    root.append(style)
    return { put: (t) => style.textContent = t }
  })
  if (sheets[0].sheet) root.adoptedStyleSheets = sheets.map((s) => s.sheet)
  let rise = (px) =>
    sheets[1].put(`:host([at=end]) { bottom: ${px}px !important }`)
  let link = document.createElement('a')
  link.href = 'https://yaks.app/'
  link.target = '_blank'
  link.rel = 'noopener'
  let name = document.createElement('b')
  name.textContent = 'yaks.app'
  link.append('Made with ', name)
  root.append(link)

  let page = document.documentElement
  // Whether the page scrolls without the badge. It is measured where it
  // stands, never moved out of the flow to ask: the page losing its height
  // for a moment would pull a person scrolled to the end back up.
  let scrolls = () => {
    let at = host.getAttribute('at')
    let own = at == 'end' || at == 'flow' ? host.offsetHeight : 0
    return page.scrollHeight - own > page.clientHeight + 1
  }
  // Whether the page's own box runs to the end of what it scrolls, so a
  // badge at its end sticks all the way down. A page held to the window's
  // height, with its body overflowing it, does not.
  let grows = () => page.getBoundingClientRect().height >= page.scrollHeight - 1
  // The fixed or sticky element holding this one in place, if any.
  let pinned = (el) => {
    for (; el && el != document.body; el = el.parentElement) {
      let { position } = getComputedStyle(el)
      if (position == 'fixed' || position == 'sticky') return el
    }
    return null
  }
  let pressed = (el) =>
    el.closest(PRESSED) || getComputedStyle(el).cursor == 'pointer'
  // A control of the app under the badge, at its corners and its middle: any
  // control on a page that never scrolls, and only a pinned one (answered as
  // what pins it) on a page that does, since anything else scrolls out from
  // under it.
  let under = (still) => {
    let { left, top, right, bottom } = link.getBoundingClientRect()
    for (
      let [x, y] of [
        [left + 1, top + 1],
        [right - 1, top + 1],
        [left + 1, bottom - 1],
        [right - 1, bottom - 1],
        [(left + right) / 2, (top + bottom) / 2],
      ]
    ) {
      let el = document.elementsFromPoint(x, y).find((e) => e != host)
      if (!el || el == page || el == document.body || !pressed(el)) continue
      let held = still ? el : pinned(el)
      if (held) return held
    }
    return null
  }
  // At the end of a page that scrolls, lifted over a bar pinned in the lower
  // half of the window, if that leaves it clear.
  let ends = () => {
    rise(0)
    host.setAttribute('at', 'end')
    if (!grows()) return false
    let bar = under(false)
    if (!bar) return true
    let top = bar.getBoundingClientRect().top
    if (top < page.clientHeight / 2) return false
    rise(page.clientHeight - top)
    return !under(false)
  }
  let place = () => {
    let still = !scrolls()
    if (!still && ends()) return
    for (let at of CORNERS) {
      host.setAttribute('at', at)
      if (!under(still)) return
    }
    host.setAttribute('at', 'flow')
  }
  // Layout moves with the app, so the spot is chosen again a moment after it
  // does: once per burst of changes, never per frame.
  let soon
  let again = () => {
    soon ??= setTimeout(() => {
      soon = null
      place()
    }, 300)
  }
  let wear = () => {
    page.append(host)
    place()
    addEventListener('resize', again)
    addEventListener('load', again)
    new MutationObserver(again).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    })
  }
  if (document.body) wear()
  else document.addEventListener('DOMContentLoaded', wear, { once: true })
})()
