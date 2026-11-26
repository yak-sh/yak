// The frame both components draw: the map's box, which MapLibre fills once
// the page is running, its credits behind an ⓘ in the box's corner that
// opens on tap, and the links under it. A map is drawn on the page only:
// rendered elsewhere (a server, a test), the box stays empty and the credits
// and links still say where the place is.
import { type ComponentChildren, h, type VNode } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { Map as MapLibre } from 'maplibre-gl'
import { draw, type Drawing } from './draw.ts'
import { TILES_DEFAULT } from './providers.ts'

export type Framed = Drawing & {
  /** what a screen reader says the map shows */
  title: string
  /** links beside the credit, such as directions */
  links?: ComponentChildren
  /** handed the MapLibre map once it is drawn, for layers of its own */
  onMap?: (map: MapLibre) => void
}

export let Frame = (p: Framed): VNode => {
  let box = useRef<HTMLDivElement>(null)
  let key = JSON.stringify([p.center, p.zoom, p.pins, p.interactive, p.lang])
  useEffect(() => {
    let el = box.current
    if (!el) return
    let map: MapLibre | undefined, gone = false
    draw(el, p).then((m) => {
      if (gone) return m.remove()
      map = m
      p.onMap?.(m)
    })
    return () => {
      gone = true
      map?.remove()
    }
  }, [key])
  let provider = p.provider ?? TILES_DEFAULT
  return h(
    'figure',
    { class: 'MapFrame' },
    h(
      'div',
      { class: 'MapBox' },
      h('div', {
        ref: box,
        class: 'MapView',
        role: 'img',
        'aria-label': p.title,
      }),
      h(
        'details',
        { class: 'MapCredit' },
        h(
          'summary',
          { title: 'Map credits' },
          h('span', { 'aria-hidden': 'true' }, 'ⓘ'),
          h('span', { class: 'MapCredit_Name' }, 'Map credits'),
        ),
        h('span', {
          dangerouslySetInnerHTML: { __html: provider.attribution },
        }),
      ),
    ),
    p.links ? h('figcaption', null, p.links) : null,
  ) as VNode
}
