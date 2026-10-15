// Controlled browser doors and consumer-owned state for controls and adapter tests.
import { parseHTML } from 'linkedom'
import type { ControlsBundle, Pad } from './controls.ts'

type Create<T> = (
  stage: HTMLElement,
  glass: HTMLElement,
  busy: () => boolean,
  state: {
    get: () => ControlsBundle
    onChange: (bundle: ControlsBundle) => void
  },
) => T

type Run<T> = (probe: {
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
}) => void

// Prepare a fresh browser and attach controls before timing event/read contracts.
// Each fixture has its own document, nodes, handlers and consumer state.
export let controlsFixture = <T extends { dispose: () => void }>(
  create: Create<T>,
) => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let events = new window.EventTarget()
  let stage = document.createElement('div')
  let glass = document.createElement('div')
  let removals: Set<EventListenerOrEventListenerObject>[] = []
  let cleanups: (() => void)[] = []
  // Count exact handler removal, rather than treating removeEventListener as a noop.
  let track = (target: EventTarget) => {
    let descriptors = {
      addEventListener: Object.getOwnPropertyDescriptor(
        target,
        'addEventListener',
      ),
      removeEventListener: Object.getOwnPropertyDescriptor(
        target,
        'removeEventListener',
      ),
    }
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
    cleanups.push(() => {
      for (let [name, group] of handlers) {
        for (let handler of group) remove(name, handler)
      }
      for (let [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(target, key, descriptor)
        else Reflect.deleteProperty(target, key)
      }
    })
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
  let install = () => {
    let before = Object.fromEntries(
      Object.keys(values).map((
        key,
      ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    )
    for (let [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, { configurable: true, value })
    }
    return () => {
      for (let [key, descriptor] of Object.entries(before)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
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
  let restore = install()
  try {
    hands = create(stage, glass, () => busy, {
      get: () => row,
      onChange: (bundle) => {
        // Controls transactions clone their input before changing it. Keep each
        // emitted snapshot, like an in-memory consumer, without cloning it twice.
        row = bundle
        changes.push(bundle)
      },
    })
  } finally {
    restore()
  }
  let attached = hands
  return (run: Run<T>) => {
    let restore = install()
    try {
      run({
        hands: attached,
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
        for (let cleanup of cleanups) cleanup()
        Object.assign(document, { pointerLockElement: null })
        restore()
      }
    }
  }
}

export let controlsProbe = <T extends { dispose: () => void }>(
  create: Create<T>,
  run: Run<T>,
) => controlsFixture(create)(run)

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
