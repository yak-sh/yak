// All hosted pages share the kit's date face and delegated tooltips.
import { time, tips } from '@yaks/ui/parts'
import { said, tip } from '@yaks/ui/relative'

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

// The tip each time was last given here: a time keeps it until the server
// draws it again, so a page saying its durations every second formats each
// moment once.
let zoned = new WeakMap<Element, string>()

/** Say server-drawn times again in the reader's clock and timezone: ages and
 * durations in words, and every tooltip, which a time inside a menu's trigger
 * lends the trigger. A written day stays the day it was drawn as. */
export let dates = (doc: Document, now = Date.now()): void => {
  for (let time of doc.querySelectorAll<HTMLElement>('time.Time')) {
    let at = time.getAttribute('datetime') ?? ''
    let face = {
      now,
      lasting: time.hasAttribute('data-lasting'),
      timeZone: time.dataset.zone,
    }
    if (face.lasting || time.hasAttribute('data-relative')) {
      let words = said(at, face)
      if (time.textContent != words) time.textContent = words
    }
    if (!time.dataset.tip || zoned.get(time) != time.dataset.tip) {
      time.dataset.tip = tip(at, face)
      zoned.set(time, time.dataset.tip)
    }
    let trigger = time.closest<HTMLElement>('[data-menu-trigger]')
    if (trigger && trigger.dataset.tip != time.dataset.tip) {
      trigger.dataset.tip = time.dataset.tip
    }
  }
  tips(doc)
}
