/** Delegated browser menu behavior for kit menus and their triggers. @module */
import { place } from './float.ts'

let installed = new WeakSet<Document>()

/** Connect `[data-menu-trigger="panel-id"]` buttons to hidden kit menus.
 * Menus escape clipping, close after actions, outside clicks or Escape, and
 * return keyboard focus to their trigger. Native buttons handle Enter/Space. */
export let menus = (doc: Document = document): void => {
  if (installed.has(doc)) return
  installed.add(doc)
  let active: { trigger: HTMLElement; panel: HTMLElement; home: Node } | null =
    null
  let items = () => [
    ...active!.panel.querySelectorAll<HTMLElement>(
      '[role=menuitem]:not(:disabled)',
    ),
  ]
  let close = (focus = false) => {
    if (!active) return
    let { trigger, panel, home } = active
    active = null
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (home.isConnected) home.appendChild(panel)
    else panel.remove()
    if (focus) trigger.focus()
  }
  let open = (trigger: HTMLElement) => {
    if (active?.trigger == trigger) return close(true)
    close()
    let panel = doc.getElementById(trigger.dataset.menuTrigger!)
    if (!panel?.parentNode) return
    active = { trigger, panel, home: panel.parentNode }
    doc.body.appendChild(panel)
    panel.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    place(panel, trigger.getBoundingClientRect(), 'below')
    items()[0]?.focus()
  }
  doc.addEventListener('click', (e) => {
    let target = e.target as Element
    let trigger = target.closest<HTMLElement>('[data-menu-trigger]')
    if (trigger) return open(trigger)
    if (!active) return
    if (!active.panel.contains(target)) close()
    else if (target.closest('[role=menuitem]')) close(true)
  })
  doc.addEventListener('keydown', (e) => {
    let trigger = (e.target as Element).closest?.('[data-menu-trigger]') as
      | HTMLElement
      | null
    if (trigger && e.key == 'ArrowDown') {
      e.preventDefault()
      return open(trigger)
    }
    if (!active) return
    if (e.key == 'Escape') {
      e.preventDefault()
      return close(true)
    }
    let list = items(), at = list.indexOf(e.target as HTMLElement)
    let next = e.key == 'Home'
      ? 0
      : e.key == 'End'
      ? list.length - 1
      : e.key == 'ArrowDown'
      ? (at + 1) % list.length
      : e.key == 'ArrowUp'
      ? (at + list.length - 1) % list.length
      : -1
    if (next >= 0) {
      e.preventDefault()
      list[next]?.focus()
    } else if (e.key == 'Tab') close()
  })
}
