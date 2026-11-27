/**
 * Draw a view into a tree with Preact: the verb a host that paints a tree of
 * its own (@yaks/tui's terminal, @yaks/native's iOS views, a test's
 * document) takes from the renderer, beside @yaks/react's.
 *
 * @module
 */

import { type ComponentChildren, options, render } from 'preact'

let mounted = 0
let prior: typeof options.requestAnimationFrame

/** Draw `node` into `into`, an element of a tree its host paints itself (an
 * @yaks/dom tree, a test's document), and answer what takes it down. Such a
 * host paints no browser frames, so effects run once the commit's microtasks
 * are done, as a browser's next frame would run them, instead of Preact's
 * fallback a few dozen milliseconds later. */
export let draw = (node: ComponentChildren, into: Element): () => void => {
  if (mounted++ == 0) {
    prior = options.requestAnimationFrame
    options.requestAnimationFrame = queueMicrotask
  }
  let release = () => {
    if (--mounted == 0) options.requestAnimationFrame = prior
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
