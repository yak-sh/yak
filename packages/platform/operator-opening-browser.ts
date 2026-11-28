/** Load the main Operator view over its opening frame after the frame draws.
 * The slot's stage goes with a timeout in the browser's loading reporter. */
import { LEAVE, leaving, PAGE, sources, swap } from '@yaks/ui/navigate'
import { retryLoading } from '@yaks/ui/interaction'
import { keptChat } from './operator-copy-browser.ts'
import { VIEW, VIEWED } from './talk-views.ts'

let afterPaint = (fn: FrameRequestCallback) =>
  requestAnimationFrame(() => requestAnimationFrame(fn))

let delivered = async (doc: Document, signal: AbortSignal) => {
  // Let the parser finish appending the shell's nodes before swapping them.
  if (doc.readyState == 'loading' && !signal.aborted) {
    let parsed = new AbortController()
    await new Promise<void>((done) => {
      doc.addEventListener('readystatechange', () => done(), {
        once: true,
        signal: parsed.signal,
      })
      signal.addEventListener('abort', () => done(), {
        once: true,
        signal: parsed.signal,
      })
    })
    parsed.abort()
  }
  if (signal.aborted) return
  let data = doc.querySelector('script[data-operator-answer]')
  if (!data) return
  let text = data.textContent
  data.remove()
  return JSON.parse(text ?? 'null') as string | null
}

let STAGE = 'data-yak-loading-stage'
let FAILED = 'data-operator-failed'
let SAID = '[data-operator-loading], [data-operator-failed]'

let open = (slot: HTMLElement): AbortSignal | undefined => {
  let doc = slot.ownerDocument
  let stage = (at: string) => slot.setAttribute(STAGE, at)
  let view = slot.closest<HTMLElement>(`[${VIEW}]`)
  let frame = view?.closest('[data-site-frame]')
  let signal = leaving(doc)
  let visible = () =>
    slot.isConnected && !signal.aborted && !view?.hidden &&
    !frame?.hasAttribute('inert')
  let { operatorOpening: path, person, space } = slot.dataset
  if (!path || !person || !space) return stage('unnamed'), undefined
  stage('bound')
  let url = new URL(path, location.href)
  let pending = slot.querySelector('[data-operator-loading]')
  let answer: Document | undefined
  let attempt: AbortController | undefined
  let show = () => {
    if (!answer) return
    if (!visible()) return stage('answered, out of sight')
    stage('drawing')
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
  let load = async (retry = false) => {
    if (!visible() || attempt && !retry) return
    if (answer) return show()
    attempt?.abort()
    let reading = attempt = new AbortController()
    let until = AbortSignal.any([signal, reading.signal])
    try {
      let streamed = !retry && slot.hasAttribute('data-operator-stream')
      if (streamed) stage('awaiting the streamed answer')
      let text = streamed ? await delivered(doc, until) : undefined
      if (until.aborted) return
      if (text == null) {
        if (!visible()) return
        stage('fetching')
        let res = await fetch(url, {
          signal: AbortSignal.any([until, AbortSignal.timeout(10_000)]),
        })
        if (!res.ok) {
          throw new Error(`Operator conversation open: ${res.status}`)
        }
        text = await res.text()
      }
      if (until.aborted) return
      stage('parsing')
      let page = new DOMParser().parseFromString(text, 'text/html')
      if (!page.querySelector('script[data-operator-chat]')) {
        throw new Error(
          'The Operator conversation response was missing its chat',
        )
      }
      answer = page
      show()
    } catch (error) {
      if (until.aborted) return
      stage('failed')
      globalThis.reportError?.(error)
      let retry = doc.createElement('button')
      retry.textContent = 'Try again'
      retry.onclick = () => {
        if (pending) status.replaceWith(pending)
        void load(true)
      }
      let status = doc.createElement('div')
      status.setAttribute('role', 'status')
      status.setAttribute(FAILED, '')
      status.append('The conversation could not be loaded. ', retry)
      let said = slot.querySelector(SAID)
      if (said) said.replaceWith(status)
      else slot.append(status)
    } finally {
      if (attempt == reading) attempt = undefined
    }
  }
  let activated = () => afterPaint(() => void load())
  retryLoading(slot, () => void load(true), signal)
  view?.addEventListener(VIEWED, activated, { signal })
  frame?.addEventListener(VIEWED, activated, { signal })
  void keptChat(space, person).then((html) => {
    if (!html || signal.aborted) return
    let kept = doc.createElement('div')
    kept.inert = true
    kept.setAttribute('data-operator-kept', '')
    kept.innerHTML = html
    slot.querySelector(':scope > [data-operator-kept]')?.remove()
    slot.prepend(kept)
    pending?.querySelector('[data-yak-loading-words]')?.setAttribute(
      'hidden',
      '',
    )
    let pane = doc.getElementById('content')
    if (pane && visible()) pane.scrollTop = pane.scrollHeight
  }).catch((e) => globalThis.reportError?.(e))
  activated()
  return signal
}

/** Open every slot in `doc` now and on every page a swap brings. A slot a
 * swap kept in place, whose listeners its page's leaving took away, is
 * opened again. */
export let opening = (
  doc: Document,
  each: (slot: HTMLElement) => AbortSignal | undefined = open,
): void => {
  let held = new WeakMap<Element, AbortSignal | undefined>()
  let bind = () => {
    for (
      let slot of doc.querySelectorAll<HTMLElement>('[data-operator-opening]')
    ) {
      if (held.has(slot) && !held.get(slot)?.aborted) continue
      held.set(slot, each(slot))
    }
  }
  bind()
  doc.addEventListener(PAGE, bind)
}

if (typeof document != 'undefined') opening(document)
