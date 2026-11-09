// All hosted pages share the kit's date face and delegated tooltips.
import { time, tips } from '@yaks/ui/parts'
import { pretty, relative } from '@yaks/ui/relative'

/** A kit timestamp for the data editor's DOM tree. */
export let stamp = (doc: Document, at: string): HTMLElement => {
  return time((tag, props, ...children) => {
    let node = doc.createElement(tag)
    for (let [key, value] of Object.entries(props ?? {})) {
      if (value != null) node.setAttribute(key, String(value))
    }
    node.textContent = children.join('')
    return node
  }, { at }) ?? doc.createElement('span')
}

/** Refresh server-rendered ages in the reader's clock and timezone. */
export let dates = (doc: Document, now = Date.now()): void => {
  for (let time of doc.querySelectorAll<HTMLElement>('time.Time')) {
    let at = time.getAttribute('datetime') ?? ''
    if (time.hasAttribute('data-relative')) time.textContent = relative(at, now)
    time.dataset.tip = pretty(at, time.dataset.zone)
  }
  tips(doc)
}
