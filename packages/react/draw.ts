/** React drawing into a browser document or a tree a host paints. @module */

import type { ReactNode } from 'react'
import { flushSync, version } from 'react-dom'
import { createRoot, hydrateRoot } from 'react-dom/client'

type Surface = { draw: (node: ReactNode) => void; close: () => void }

// React DOM consults window and the iframe constructor for focus restoration.
// The in-memory document has neither a window of its own nor frame elements.
let surfaces = 0
let restore: () => void
let documents = new WeakMap<Document, { refs: number; close: () => void }>()

// React sets the option properties for a controlled select. A painted tree
// reads those states from its attributes.
let controls = (doc: Document): () => void => {
  let create = doc.createElement
  let createNS = doc.createElementNS
  let control = (element: Element, name: string) => {
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
  let current = globalThis.window
  if (
    doc.defaultView && typeof current?.HTMLIFrameElement == 'function' &&
    surfaces == 0
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
  // The repository's Preact compatibility runtime draws without a window.
  if (parseInt(version) < 19) return release
  if (surfaces++ == 0) {
    let frame = current ?? doc.defaultView ?? globalThis
    let undo: (() => void)[] = []
    let supply = (target: object, name: string, value: unknown) => {
      if (Reflect.get(target, name) != null) return
      let prior = Object.getOwnPropertyDescriptor(target, name)
      Object.defineProperty(target, name, {
        value,
        writable: true,
        configurable: true,
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
    if (--surfaces == 0) restore()
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
      : resume(into, initial, options)
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
        flushSync(() => root.render(node))
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
