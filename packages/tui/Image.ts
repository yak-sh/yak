/** A graph-independent, lazy terminal image. The backend owns loading and graphics. */
import { h, type JSX } from 'preact'
import type { TElement } from './dom.ts'

export type ImageSource = {
  key: string
  load: () => Promise<Uint8Array>
  alt: string
  rows: number
}

/** Fixed cell height avoids moving scroll anchors when bytes arrive. */
export let Image = (
  { source }: { source: ImageSource },
): JSX.Element =>
  h('terminal-image', {
    ref: (node: unknown) => {
      if (node) (node as TElement).image = source
    },
  })
