/**
 * Draw a view into a tree with Preact: the verb a host that paints a tree of
 * its own (@yaks/tui's terminal, @yaks/native's iOS views, a test's
 * document) takes from the renderer, beside @yaks/react's.
 *
 * @module
 */

import { type ComponentChildren, options, render } from 'preact'

let mounted = 0
let restore = () => {}

/** Supply the paint scheduler while a host or test owns the document. */
export let frames = (
  schedule: NonNullable<typeof options.requestAnimationFrame>,
): () => void => {
  let prior = options.requestAnimationFrame
  options.requestAnimationFrame = schedule
  return () => {
    options.requestAnimationFrame = prior
  }
}

/** Draw `node` into `into`, an element of a tree its host paints itself (an
 * @yaks/dom tree, a test's document), and answer what takes it down. Such a
 * host paints no browser frames, so effects run once the commit's microtasks
 * are done, as a browser's next frame would run them, instead of Preact's
 * fallback a few dozen milliseconds later. */
export let draw = (node: ComponentChildren, into: Element): () => void => {
  if (mounted++ == 0) restore = frames(queueMicrotask)
  let release = () => {
    if (--mounted == 0) restore()
  }
  try {
    render(node, into)
  } catch (error) {
    release()
    throw error
  }
  return () => {
    try {
      render(null, into)
    } finally {
      release()
    }
  }
}
