/**
 * The watch over an Operator page's opening frame (operator-page.ts
 * `openingParts`): the slot holding `Loading conversation…` until the
 * conversation is laid over it (./operator-opening-browser.ts). A slot that
 * stands in sight for `LONG` with nothing laid over it says the conversation
 * could not be opened, offers to try again, and reports to the tracker what
 * the page had reached (the slot's `data-operator-stage`, which the opening
 * module marks as it goes, `unbound` where it never ran).
 *
 * It is an inline classic script rather than a part of the opening module,
 * so it watches even when that module never loads or never runs.
 *
 * @module
 */

/** How long, in milliseconds, the slot may stand in sight. */
export let LONG = 15_000

/** The mark the slot wears once the watch has said it is stuck. */
export let STUCK = 'data-operator-stuck'

// Keep this source literal. It runs in the page and has no access to any
// helpers introduced by the Worker's bundler.
let WATCH = `(slot, browser, door) => {
  let doc = slot.ownerDocument, waited = 0, STEP = 1000
  let seen = () => doc.visibilityState != 'hidden' &&
    !slot.closest('[hidden], [inert]')
  let stuck = () => {
    slot.setAttribute('${STUCK}', '')
    let at = browser.location.href
    let stage = slot.getAttribute('data-operator-stage') || 'unbound'
    let message = 'The Operator conversation stayed on Loading for ${
  LONG / 1000
} s'
    try {
      let body = JSON.stringify({
        message,
        stack: 'Error: ' + message + '\\n    at ' + at + ' (stage ' + stage +
          ', document ' + doc.readyState + ')',
        page: at,
        mechanism: 'onerror',
      })
      if (!browser.navigator.sendBeacon?.(door, body)) {
        browser.fetch(door, { method: 'POST', body, keepalive: true })
          .catch(() => {})
      }
    } catch {}
    let said = doc.createElement('div')
    said.setAttribute('role', 'status')
    said.setAttribute('data-operator-failed', '')
    let again = doc.createElement('button')
    again.type = 'button'
    again.textContent = 'Try again'
    again.onclick = () => browser.location.reload()
    said.append('The conversation could not be opened. ', again)
    let was = slot.querySelector('[data-operator-loading], [data-operator-failed]')
    if (was) was.replaceWith(said)
    else slot.append(said)
  }
  let tick = () => {
    if (!slot.isConnected || slot.hasAttribute('${STUCK}')) return
    waited = seen() ? waited + STEP : 0
    if (waited < ${LONG}) browser.setTimeout(tick, STEP)
    else stuck()
  }
  browser.setTimeout(tick, STEP)
}`

/** The watch, standing immediately after its slot, reporting at `door`
 * (the page reporter's, page-report.ts). */
export let openingWatchScript = (door: string): string =>
  `(${WATCH})(document.currentScript.previousElementSibling,window,${
    JSON.stringify(door)
  })`
