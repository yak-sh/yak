// Controlled browser doors and consumer-owned state for controls and adapter tests.
import { parseHTML } from 'linkedom'
import type { ControlsBundle, Pad } from './controls.ts'

export let controlsProbe = <T extends { dispose: () => void }>(
  create: (
    stage: HTMLElement,
    glass: HTMLElement,
    busy: () => boolean,
    state: {
      get: () => ControlsBundle
      onChange: (bundle: ControlsBundle) => void
    },
  ) => T,
  run: (probe: {
    hands: T
    stage: HTMLElement
    glass: HTMLElement
    row: () => ControlsBundle
    replace: (row: ControlsBundle) => void
    changes: ControlsBundle[]
    busy: (value: boolean) => void
    pads: (value: (Pad | null)[]) => void
    polls: () => number
    refusePads: (error: Error | undefined) => void
    send: (type: string, fields?: Record<string, unknown>) => Event
    lock: () => void
    locked: () => boolean
    requests: () => number
    captures: Set<number>
    listeners: () => number
    dispose: () => void
  }) => void,
) => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let events = new window.EventTarget()
  let stage = document.createElement('div')
  let glass = document.createElement('div')
  let removals: Set<EventListenerOrEventListenerObject>[] = []
  // Count exact handler removal, rather than treating removeEventListener as a noop.
  let track = (target: EventTarget) => {
    let add = target.addEventListener.bind(target)
    let remove = target.removeEventListener.bind(target)
    let handlers = new Map<string, Set<EventListenerOrEventListenerObject>>()
    target.addEventListener = (name, handler, options) => {
      if (handler) {
        let group = handlers.get(name)
        if (!group) {
          group = new Set()
          handlers.set(name, group)
          removals.push(group)
        }
        group.add(handler)
      }
      add(name, handler, options)
    }
    target.removeEventListener = (name, handler, options) => {
      if (handler) handlers.get(name)?.delete(handler)
      remove(name, handler, options)
    }
  }
  for (let target of [events, document, stage]) track(target)
  let padList: (Pad | null)[] = [], padError: Error | undefined
  let polls = 0, requests = 0, busy = false
  let captures = new Set<number>()
  let row: ControlsBundle = { entity: { eid: 'test-consumer:pilot-controls' } }
  let changes: ControlsBundle[] = []
  let values = {
    document,
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    navigator: {
      getGamepads: () => {
        polls++
        if (padError) throw padError
        return padList
      },
    },
  }
  let before = Object.fromEntries(
    Object.keys(values).map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (let [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  Object.assign(stage, {
    setPointerCapture: (id: number) => {
      if (document.pointerLockElement) {
        throw new DOMException('A pointer is locked', 'InvalidStateError')
      }
      captures.add(id)
    },
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    requestPointerLock: () => {
      requests++
    },
  })
  Object.assign(document, {
    pointerLockElement: null,
    exitPointerLock: () => {
      Object.assign(document, { pointerLockElement: null })
      document.dispatchEvent(new window.Event('pointerlockchange'))
    },
  })
  let hands: T | undefined
  let disposed = false
  let dispose = () => {
    if (disposed || !hands) return
    hands.dispose()
    disposed = true
  }
  try {
    hands = create(stage, glass, () => busy, {
      get: () => structuredClone(row),
      onChange: (bundle) => {
        changes.push(structuredClone(bundle))
        row = structuredClone(bundle)
      },
    })
    run({
      hands,
      stage,
      glass,
      row: () => structuredClone(row),
      replace: (value) => {
        row = structuredClone(value)
      },
      changes,
      busy: (value) => {
        busy = value
      },
      pads: (value) => {
        padList = value
      },
      polls: () => polls,
      refusePads: (error) => {
        padError = error
      },
      captures,
      listeners: () => removals.reduce((n, group) => n + group.size, 0),
      dispose,
      requests: () => requests,
      locked: () => document.pointerLockElement == stage,
      lock: () => {
        captures.clear() // Pointer lock drops capture in the browser.
        Object.assign(document, { pointerLockElement: stage })
        document.dispatchEvent(new window.Event('pointerlockchange'))
      },
      send: (type, fields = {}) => {
        let e = new window.Event(type, { cancelable: true })
        Object.assign(e, {
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: 1,
          clientX: 400,
          clientY: 300,
          movementX: 10,
          movementY: 5,
          ...fields,
        })
        if (['keydown', 'keyup', 'mouseup', 'blur', 'focus'].includes(type)) {
          events.dispatchEvent(e)
        } else if (type == 'pointerlockchange') document.exitPointerLock()
        else stage.dispatchEvent(e)
        if (type == 'pointerup' || type == 'pointercancel') {
          captures.delete((e as PointerEvent).pointerId)
        }
        return e
      },
    })
  } finally {
    try {
      dispose()
    } finally {
      for (let [key, descriptor] of Object.entries(before)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  }
}

export let pad = (
  axes: number[] = [],
  pressed: number[] = [],
  connected = true,
): Pad => ({
  axes,
  connected,
  buttons: Array.from({ length: 12 }, (_, i) => ({
    pressed: pressed.includes(i),
    touched: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
})
