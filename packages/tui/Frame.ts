/**
 * The screen's shape: a main column with a sidebar of panels on the right. A
 * panel is `{title, Render}` — anything that draws, contributed by whoever
 * knows what belongs there — so the frame itself knows nothing about what it
 * shows. The sidebar takes a fixed or proportional terminal width and folds away
 * below `min` terminal columns.
 *
 * @module
 */

import { type ComponentChildren, type ComponentType, h, type JSX } from 'preact'
import { size } from './screen.ts'
import { Scroll } from './Scroll.ts'

/** One sidebar panel: a heading and whatever draws under it. */
export type Panel = {
  title: string
  titleClass?: string
  /** Share remaining sidebar height instead of measuring unbounded content. */
  bounded?: boolean
  /** Shrink to content within a fair share; expanding panels receive unused rows. */
  fit?: boolean
  /** Content already owns a scrolling viewport. */
  scrollable?: boolean
  Render: ComponentType
}

/** Terminal frame with a right sidebar; below `min` columns it is hidden. */
export let Frame = (
  { sidebar = [], width = 30, ratio, min = 90, children }: {
    sidebar?: Panel[]
    /** Fixed columns, or minimum columns when ratio is supplied. */
    width?: number
    /** Fraction of terminal width (0–1). Rounded down; leaves one main column. */
    ratio?: number
    min?: number
    children?: ComponentChildren
  },
): JSX.Element => {
  if (ratio != null && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)) {
    throw new RangeError('Frame ratio must be between 0 and 1')
  }
  let columns = size.value.columns
  let sidebarWidth = ratio == null ? width : Math.min(
    Math.max(width, Math.floor(columns * ratio)),
    Math.max(0, columns - 1),
  )
  let wide = sidebar.length > 0 && columns >= min
  return h(
    'div',
    { row: '1' },
    h('div', { grow: '1', col: '1' }, children),
    wide
      ? h(
        'div',
        { width: String(sidebarWidth), col: '1', class: 'Frame_Side' },
        ...sidebar.map((p) =>
          h(
            'div',
            {
              class: 'Panel',
              key: p.title,
              ...(p.bounded
                ? { grow: '1', col: '1', ...(p.fit ? { 'grow-fit': '1' } : {}) }
                : {}),
            },
            h('div', {
              class: ['Panel_Title', p.titleClass].filter(Boolean).join(' '),
            }, p.title),
            p.bounded
              ? p.scrollable
                ? h('div', { grow: '1' }, h(p.Render, {}))
                : h(Scroll, {
                  id: 'panel-' + p.title,
                  grow: '1',
                  follow: false,
                  keyboard: false,
                }, h(p.Render, {}))
              : h(p.Render, {}),
          )
        ),
      )
      : null,
  )
}
