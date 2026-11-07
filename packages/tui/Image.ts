/** A graph-independent, lazy terminal image. The backend owns loading and graphics. */
import { h, type JSX } from 'preact'
import type { TElement } from '@yaks/dom'
import { images } from './paint.ts'

export type ImageSource = {
  key: string
  load: () => Promise<Uint8Array>
  alt: string
  rows: number
}

/** The ref that makes a `terminal-image` element paint `source`, for a
 * renderer that names its tags rather than its components. */
export let showing = (source: ImageSource) => (node: unknown): void => {
  if (node) images.set(node as TElement, source)
}

/** Fixed cell height avoids moving scroll anchors when bytes arrive. */
export let Image = (
  { source }: { source: ImageSource },
): JSX.Element => h('terminal-image', { ref: showing(source) })
