/** Preact compatibility roots for a host that paints its own tree. @module */

import {
  createRoot as create,
  hydrateRoot as hydrate,
} from 'preact/compat/client'
import { paintFrames } from './draw.ts'

let root = (open: () => ReturnType<typeof create>) => {
  let release = paintFrames()
  try {
    let { render, unmount } = open()
    return {
      render,
      unmount() {
        try {
          unmount()
        } finally {
          release()
        }
      },
    }
  } catch (error) {
    release()
    throw error
  }
}

/** Mount a Preact compatibility view into the host's tree. */
export let createRoot: typeof create = (...args) => root(() => create(...args))

/** Attach a Preact compatibility view to the existing tree. */
export let hydrateRoot: typeof hydrate = (...args) =>
  root(() => hydrate(...args))
