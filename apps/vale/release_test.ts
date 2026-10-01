// Take over the actual window event while keeping drafts and controls usable.
import { equal, ok, test, tick } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { releaseNotice } from './release.ts'

let page = async (
  run: (p: {
    document: Document
    glass: HTMLElement
    gate: HTMLElement
    send: (version: number, reload: string) => boolean
    reloads: () => number
    dispose: () => void
    storage: Map<string, string>
    measure: () => void
  }) => void | Promise<void>,
) => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let storage = new Map<string, string>()
  let measure = () => {}
  let values = {
    document,
    Event: window.Event,
    location: { href: 'https://yaks.app/vale/game/', pathname: '/vale/game/' },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    MutationObserver: window.MutationObserver,
    ResizeObserver: class {
      constructor(callback: () => void) {
        measure = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  }
  let before = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  )
  for (let [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  let glass = document.createElement('div')
  glass.className = 'Hud'
  let gate = document.createElement('div')
  gate.className = 'Gate'
  document.body.append(glass, gate)
  let reloads = 0
  let dispose = releaseNotice(glass, gate, () => reloads++)
  try {
    await run({
      document: document as unknown as Document,
      glass,
      gate,
      send: (version, reload) =>
        window.dispatchEvent(
          new window.CustomEvent('yak-release', {
            cancelable: true,
            detail: { version, reload, future: 'kept' },
          }),
        ),
      reloads: () => reloads,
      dispose,
      storage,
      measure: () => measure(),
    })
  } finally {
    dispose()
    Object.keys(values).forEach((key, i) => {
      if (before[i]) Object.defineProperty(globalThis, key, before[i]!)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}

let buttons = (root: HTMLElement) => [...root.querySelectorAll('button')]

test('Vale cancels the default notice, dismisses only this optional version and reloads only on click', () =>
  page(({ glass, send, reloads, storage }) => {
    equal(send(2, 'optional'), false)
    let notice = glass.querySelector<HTMLElement>('.Release')!
    equal(notice.getAttribute('role'), 'status')
    equal(
      notice.querySelector('span')!.textContent,
      'A new version of this app is out',
    )
    equal(buttons(notice).map((b) => b.textContent), ['Reload', 'Dismiss'])
    equal(reloads(), 0)
    buttons(notice)[1].click()
    equal(glass.querySelector('.Release'), null)
    equal(storage.get('yak-release:/vale/game/api/release:2'), 'dismissed')
    equal(send(2, 'optional'), false)
    equal(glass.querySelector('.Release'), null)
    equal(send(3, 'optional'), false)
    equal(glass.querySelectorAll('.Release').length, 1)
    equal(reloads(), 0)
    buttons(glass.querySelector<HTMLElement>('.Release')!)[0].click()
    equal(reloads(), 1)
  }))

test('required Vale notice persists across older events and tab dismissal, leaving a draft and its keys intact', () =>
  page(({ document, glass, send, reloads, storage }) => {
    let field = document.createElement('textarea')
    field.value = 'an unsent message'
    glass.append(field)
    let focused = field
    Object.defineProperty(document, 'activeElement', { get: () => focused })
    // If the notice tries to focus a button, the draft would lose its focus.
    let prototype = Object.getPrototypeOf(field)
    let old = Object.getOwnPropertyDescriptor(prototype, 'focus')
    Object.defineProperty(prototype, 'focus', {
      configurable: true,
      value: function () {
        focused = this
      },
    })
    try {
      storage.set('yak-release:/vale/game/api/release:4', 'dismissed')
      send(3, 'optional')
      equal(send(4, 'required'), false)
      let notice = glass.querySelector<HTMLElement>('.Release')!
      equal(
        notice.querySelector('span')!.textContent,
        'This app has changed. Reload to keep using it',
      )
      equal(buttons(notice).map((b) => b.textContent), ['Reload'])
      send(3, 'optional')
      equal(glass.querySelector('.Release'), notice)
      equal(document.activeElement, field)
      equal(field.value, 'an unsent message')
      equal(reloads(), 0)
      let gameKeys = 0
      document.addEventListener('keydown', () => gameKeys++)
      let enter = new Event('keydown', { bubbles: true, cancelable: true })
      buttons(notice)[0].dispatchEvent(enter)
      equal(gameKeys, 0)
      equal(enter.defaultPrevented, false)
      // Native button activation may now dispatch click; nothing else reloads.
      buttons(notice)[0].click()
      equal(reloads(), 1)
      equal(field.value, 'an unsent message')
    } finally {
      if (old) Object.defineProperty(prototype, 'focus', old)
      else Reflect.deleteProperty(prototype, 'focus')
    }
  }))

test('Vale notice follows the visible glass, reserves its measured room and releases its listener', () =>
  page(async ({ glass, gate, send, measure, dispose, storage }) => {
    glass.hidden = true
    send(8, 'required')
    let notice = gate.querySelector<HTMLElement>('.Release')!
    ok(notice)
    notice.getBoundingClientRect = () => ({ height: 72 }) as DOMRect
    measure()
    equal(gate.style.getPropertyValue('--release-height'), '72px')
    equal(glass.style.getPropertyValue('--release-height'), '0px')
    glass.hidden = false
    await tick()
    equal(glass.querySelector('.Release'), notice)
    equal(gate.querySelector('.Release'), null)
    equal(glass.style.getPropertyValue('--release-height'), '72px')
    storage.set('yak-release:/vale/game/api/release:9', 'dismissed')
    send(9, 'optional')
    equal(glass.querySelector('.Release'), null)
    equal(glass.style.getPropertyValue('--release-height'), '0px')
    equal(send(10, 'unknown'), true)
    dispose()
    equal(send(11, 'required'), true)
    equal(glass.querySelector('.Release'), null)
  }))
