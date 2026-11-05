// The chat page's live updates (operator-page.ts `chatScript`): puts `html`
// in `at`, keeping open every entry (a `details`) the person had open there,
// each known by the row it sits in and the summaries leading to it, so a live
// update never closes what they opened. Served as it is written: a function's
// bundled source is the bundler's, which calls helpers the page lacks.

/**
 * @param {Element} at
 * @param {string} html
 */
export function redraw(at, html) {
  /** @param {Element} entry */
  let key = (entry) => {
    let path = []
    for (let e = entry; e && e != at; e = e.parentElement) {
      if (e.id) return [e.id, ...path].join('\n')
      if (e.localName == 'details') {
        path.unshift(
          [...e.children].find((c) => c.localName == 'summary')
            ?.textContent ?? '',
        )
      }
    }
    return path.join('\n')
  }
  // Entries alike in all of that are told apart by their order.
  let keys = () => {
    /** @type {Record<string, number>} */
    let seen = {}
    return [...at.querySelectorAll('details')].map((d) => {
      let k = key(d)
      seen[k] = (seen[k] ?? 0) + 1
      return /** @type {const} */ ([d, k + '\n' + seen[k]])
    })
  }
  let open = new Set(
    keys().filter(([d]) => d.hasAttribute('open')).map(([, k]) => k),
  )
  at.innerHTML = html
  for (let [d, k] of keys()) if (open.has(k)) d.setAttribute('open', '')
}
