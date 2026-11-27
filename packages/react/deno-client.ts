/** React DOM's client when Deno paints a document in memory. @module */

import { doc } from '@yaks/dom'
import type * as Client from 'npm:react-dom@19.3.0/client'

// React DOM probes for input events when the module loads. The terminal
// delivers those events and does not implement Internet Explorer's events.
let load = async (): Promise<typeof Client> => {
  let document = { ...doc, oninput: null }
  let window = Object.assign(new EventTarget(), { document })
  let undo = Object.entries({ document, window }).map(([name, value]) => {
    let before = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { value, configurable: true })
    return () => {
      if (before) Object.defineProperty(globalThis, name, before)
      else Reflect.deleteProperty(globalThis, name)
    }
  })
  try {
    return await import('npm:react-dom@19.3.0/client')
  } finally {
    for (let restore of undo) restore()
  }
}

let client = await load()

/** Start a root in the supplied document. */
export let createRoot: typeof Client.createRoot = client.createRoot

/** Attach a root to existing HTML. */
export let hydrateRoot: typeof Client.hydrateRoot = client.hydrateRoot
