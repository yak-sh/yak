/** Load the main Operator view over its opening frame after the frame draws. */
import { arrived, LEAVE, leaving, PAGE, sources, swap } from '@yaks/ui/navigate'
import { keptChat } from './operator-copy-browser.ts'
import { VIEW, VIEWED } from './talk-views.ts'

let afterPaint = (fn: FrameRequestCallback) =>
  requestAnimationFrame(() => requestAnimationFrame(fn))

let open = (slot: HTMLElement) => {
  let doc = slot.ownerDocument
  let view = slot.closest<HTMLElement>(`[${VIEW}]`)
  let frame = view?.closest('[data-site-frame]')
  let signal = leaving(doc)
  let visible = () =>
    slot.isConnected && !signal.aborted && !view?.hidden &&
    !frame?.hasAttribute('inert')
  let { operatorOpening: path, person, space } = slot.dataset
  if (!path || !person || !space) return
  let url = new URL(path, location.href)
  let answer: Document | undefined, reading = false
  let show = () => {
    if (!answer || !visible()) return
    let ran = sources(doc)
    let began = performance.now()
    doc.dispatchEvent(new CustomEvent(LEAVE))
    let tally = swap(doc, answer, ran)
    doc.dispatchEvent(
      new CustomEvent(PAGE, {
        detail: {
          began,
          url: location.href,
          from: 'fresh',
          tally,
          phases: { wait: 0, swap: performance.now() - began },
        },
      }),
    )
    if (location.hash.startsWith('#row-')) {
      doc.getElementById(location.hash.slice(1))?.scrollIntoView()
    }
  }
  let load = async () => {
    if (!visible() || reading) return
    if (answer) return show()
    reading = true
    try {
      let res = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      })
      if (!res.ok) throw new Error(`Operator conversation open: ${res.status}`)
      let page = new DOMParser().parseFromString(await res.text(), 'text/html')
      if (!page.querySelector('script[data-operator-chat]')) {
        throw new Error(
          'The Operator conversation response was missing its chat',
        )
      }
      answer = page
      show()
    } catch (error) {
      if (signal.aborted) return
      globalThis.reportError?.(error)
      let retry = doc.createElement('button')
      retry.textContent = 'Try again'
      retry.onclick = () => void load()
      let status = doc.createElement('div')
      status.setAttribute('role', 'status')
      status.append('The conversation could not be loaded. ', retry)
      slot.querySelector('[role=status]')?.replaceWith(status)
    } finally {
      reading = false
    }
  }
  let activated = () => afterPaint(() => void load())
  view?.addEventListener(VIEWED, activated, { signal })
  frame?.addEventListener(VIEWED, activated, { signal })
  void keptChat(space, person).then((html) => {
    if (!html || signal.aborted) return
    let kept = doc.createElement('div')
    kept.inert = true
    kept.innerHTML = html
    slot.prepend(kept)
    slot.querySelector('[data-operator-loading]')?.setAttribute('hidden', '')
    let pane = doc.getElementById('content')
    if (pane && visible()) pane.scrollTop = pane.scrollHeight
  }).catch((e) => globalThis.reportError?.(e))
  activated()
}

if (typeof document != 'undefined') {
  arrived<HTMLElement>('[data-operator-opening]', open)
}
