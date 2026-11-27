/** React drawing into a browser document or a tree a host paints. @module */

import type { ReactNode } from 'react'
import { flushSync, version } from 'react-dom'
import { createRoot, hydrateRoot } from 'react-dom/client'

type Surface = { draw: (node: ReactNode) => void; close: () => void }
let modern = parseInt(version) >= 19
let commit = modern ? flushSync : <T>(draw: () => T) => draw()

// React DOM consults window and the iframe constructor for focus restoration.
// The in-memory document has neither a window of its own nor frame elements.
let surfaces = 0
let restore: (() => void) | undefined
let documents = new WeakMap<Document, { refs: number; close: () => void }>()

// A painted tree dispatches capture listeners under a separate event name.
let listening = new WeakSet<Element>()
let eventName = (type: string, options?: boolean | EventListenerOptions) =>
  (typeof options == 'boolean' ? options : options?.capture)
    ? type + 'Capture'
    : type
let listen = (element: Element) => {
  if (listening.has(element)) return
  listening.add(element)
  let add = element.addEventListener
  let remove = element.removeEventListener
  element.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) =>
    listener && add.call(
      element,
      eventName(type, options),
      listener,
      options,
    )) as typeof add
  element.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) =>
    listener && remove.call(
      element,
      eventName(type, options),
      listener,
      options,
    )) as typeof remove
}

// React sets the option properties for a controlled select. A painted tree
// reads those states from its attributes.
let controls = (doc: Document): () => void => {
  let create = doc.createElement
  let createNS = doc.createElementNS
  let control = (element: Element, name: string) => {
    listen(element)
    if (!('nodeName' in element)) {
      Object.defineProperty(element, 'nodeName', {
        get: () => (element as Element).tagName,
      })
    }
    if (['input', 'textarea', 'select'].includes(name)) {
      let props = name == 'input' ? ['type', 'name'] : ['name']
      for (let prop of props) {
        if (prop in element) continue
        Object.defineProperty(element, prop, {
          get: () => element.getAttribute(prop) ?? '',
          set: (value: string) => element.setAttribute(prop, value),
        })
      }
    }
    if (name == 'input' || name == 'textarea') {
      if (!('defaultValue' in element)) {
        Object.defineProperty(element, 'defaultValue', {
          get: () => element.getAttribute('value') ?? '',
          set: (value: string) => {
            if (!element.hasAttribute('value')) {
              element.setAttribute('value', value)
            }
          },
        })
      }
    }
    if (name == 'select' && !('options' in element)) {
      let choices = () => Array.from(element.querySelectorAll('option'))
      Object.defineProperties(element, {
        options: { get: choices },
        value: {
          get: () => {
            let listed = choices()
            return (listed.find((option) => option.selected) ?? listed[0])
              ?.value ?? ''
          },
          set: (value: string) => {
            for (let option of choices()) {
              option.selected = option.value == value
            }
          },
        },
      })
    }
    if (name == 'option' && !('selected' in element)) {
      for (let property of ['selected', 'defaultSelected']) {
        Object.defineProperty(element, property, {
          get: () => element.hasAttribute('selected'),
          set: (on: boolean) => {
            if (!on) return element.removeAttribute('selected')
            let select = element.closest<HTMLSelectElement>('select')
            if (select && !select.multiple) {
              for (let option of select.querySelectorAll('option[selected]')) {
                option.removeAttribute('selected')
              }
            }
            element.setAttribute('selected', '')
          },
        })
      }
    }
    return element
  }
  doc.createElement =
    ((name: string, options?: ElementCreationOptions) =>
      control(create.call(doc, name, options), name)) as typeof create
  doc.createElementNS = ((
    namespace: string | null,
    name: string,
    options?: string | ElementCreationOptions,
  ) =>
    control(
      createNS.call(doc, namespace, name, options),
      name,
    )) as typeof createNS
  return () => {
    doc.createElement = create
    doc.createElementNS = createNS
  }
}

let attach = (doc: Document) => {
  if (!modern) return () => {}
  let current = globalThis.window
  if (
    typeof doc.defaultView?.HTMLIFrameElement == 'function' &&
    typeof current?.HTMLIFrameElement == 'function' &&
    !restore
  ) {
    return () => {}
  }
  let held = doc.defaultView ? undefined : documents.get(doc)
  if (!doc.defaultView) {
    if (!held) documents.set(doc, held = { refs: 0, close: controls(doc) })
    held.refs++
  }
  let release = () => {
    if (held && --held.refs == 0) {
      held.close()
      documents.delete(doc)
    }
  }
  let view = doc.defaultView
  let frameClass = view && typeof view.HTMLIFrameElement != 'function'
    ? Object.getOwnPropertyDescriptor(view, 'HTMLIFrameElement')
    : undefined
  let absent = view && typeof view.HTMLIFrameElement != 'function'
  if (absent) {
    Object.defineProperty(view, 'HTMLIFrameElement', {
      value: class {},
      configurable: true,
    })
  }
  surfaces++
  if (!restore) {
    let frame = current ?? doc.defaultView ?? globalThis
    let undo: (() => void)[] = []
    let supply = (target: object, name: string, value: unknown) => {
      if (Reflect.get(target, name) != null) return
      let prior = Object.getOwnPropertyDescriptor(target, name)
      Object.defineProperty(target, name, {
        value,
        configurable: true,
        writable: true,
      })
      undo.push(() => {
        if (prior) Object.defineProperty(target, name, prior)
        else Reflect.deleteProperty(target, name)
      })
    }
    supply(globalThis, 'window', frame)
    supply(frame, 'HTMLIFrameElement', class {})
    restore = () => {
      for (let reset of undo.reverse()) reset()
    }
  }
  return () => {
    release()
    if (view && absent) {
      if (frameClass) {
        Object.defineProperty(view, 'HTMLIFrameElement', frameClass)
      } else Reflect.deleteProperty(view, 'HTMLIFrameElement')
    }
    if (--surfaces == 0) {
      let release = restore
      let after = (globalThis as { setImmediate?: (f: () => void) => unknown })
        .setImmediate ?? setTimeout
      after(() => {
        if (surfaces || restore !== release) return
        restore = undefined
        release?.()
      })
    }
  }
}

/** Mount a React root whose draws commit before returning, so its caller can
 * measure the tree or restore selection and scroll after a draft swap. */
export let surface = (
  into: Element,
  fell?: (error: unknown) => void,
  initial?: ReactNode,
): Surface => {
  let release = attach(into.ownerDocument)
  if (modern && !into.ownerDocument.defaultView) listen(into)
  let root
  let committing = false
  let failure: { error: unknown } | undefined
  type Root = ReturnType<typeof createRoot>
  type Options = { onUncaughtError: (error: unknown) => void }
  let open: (into: Element, options?: Options) => Root = createRoot
  let resume: (into: Element, view: ReactNode, options?: Options) => Root =
    hydrateRoot
  let options: Options = {
    onUncaughtError(error) {
      if (committing) failure = { error }
      else if (fell) fell(error)
      else {
        queueMicrotask(() => {
          throw error
        })
      }
    },
  }
  try {
    root = initial === undefined
      ? open(into, options)
      : commit(() => resume(into, initial, options))
  } catch (error) {
    release()
    throw error
  }
  let closed = false
  return {
    draw: (node) => {
      failure = undefined
      committing = true
      try {
        commit(() => root.render(node))
      } finally {
        committing = false
      }
      if (failure) throw (failure as { error: unknown }).error
    },
    close: () => {
      if (closed) return
      closed = true
      try {
        root.unmount()
      } finally {
        release()
      }
    },
  }
}

let roots = new WeakMap<Element, Surface>()

/** Draw a page island into its retained root. Null takes the island down. */
export let render = (view: ReactNode, into: Element): void => {
  let held = roots.get(into)
  if (view === null) {
    held?.close()
    roots.delete(into)
    return
  }
  if (!held) roots.set(into, held = surface(into))
  held.draw(view)
}

/** Attach a page island to existing HTML, retaining its root for updates. */
export let hydrate = (view: ReactNode, into: Element): void => {
  if (roots.has(into)) return render(view, into)
  roots.set(into, surface(into, undefined, view))
}

/** Draw a view into a tree and return what takes it down. */
export let draw = (node: ReactNode, into: Element): () => void => {
  let mount = surface(into)
  try {
    mount.draw(node)
  } catch (error) {
    mount.close()
    throw error
  }
  return mount.close
}
