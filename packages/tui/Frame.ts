/**
 * The screen's shape: a main column with a sidebar of panels on the right. A
 * panel is `{title, Render}` — anything that draws, contributed by whoever
 * knows what belongs there — so the frame itself knows nothing about what it
 * shows. The sidebar takes a fixed width and folds away below `min` columns,
 * because a narrow terminal wants the transcript, not the furniture.
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
  /** Content already owns a scrolling viewport. */
  scrollable?: boolean
  Render: ComponentType
}

/** Main column plus right sidebar; below `min` columns the sidebar folds. */
export let Frame = (
  { sidebar = [], width = 30, min = 90, children }: {
    sidebar?: Panel[]
    width?: number
    min?: number
    children?: ComponentChildren
  },
): JSX.Element => {
  let wide = sidebar.length > 0 && size.value.columns >= min
  return h(
    'div',
    { row: '1' },
    h('div', { grow: '1', col: '1' }, children),
    wide
      ? h(
        'div',
        { width: String(width), col: '1', class: 'Frame_Side' },
        ...sidebar.map((p) =>
          h(
            'div',
            {
              class: 'Panel',
              key: p.title,
              ...(p.bounded ? { grow: '1', col: '1' } : {}),
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
