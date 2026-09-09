/**
 * The package, driven: `deno run -A packages/tui/demo.ts`. A transcript of 500
 * lines you can scroll (arrows, page keys, the wheel), an input box that
 * appends to it (Enter sends, Shift+Enter opens a line), and a sidebar of two
 * panels that fold away below 90 columns. Ctrl-C quits.
 *
 * @module
 */

import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Frame, type Panel, run, Scroll, size, Textarea } from './mod.ts'

let words = 'graph entity component wire paint session claim board terminal'
  .split(' ')
let fake = (n: number) =>
  `${String(n).padStart(3, '0')} ${
    Array.from({ length: 3 + (n % 7) }, (_, i) => words[(n + i) % words.length])
      .join(' ')
  }`

let App = () => {
  let [lines, setLines] = useState<string[]>(
    Array.from({ length: 500 }, (_, i) => fake(i)),
  )
  let sidebar: Panel[] = [
    {
      title: 'Session',
      Render: () =>
        h(
          'div',
          null,
          h(
            'div',
            null,
            h('span', { class: 'Muted' }, 'lines '),
            h('span', { class: 'Key' }, String(lines.length)),
          ),
          h(
            'div',
            null,
            h('span', { class: 'Muted' }, 'size  '),
            h(
              'span',
              { class: 'Key' },
              `${size.value.columns}x${size.value.rows}`,
            ),
          ),
        ),
    },
    {
      title: 'Keys',
      Render: () =>
        h(
          'div',
          null,
          h(
            'div',
            null,
            h('span', { class: 'Key' }, '⏎'),
            h('span', { class: 'Dim' }, ' send'),
          ),
          h(
            'div',
            null,
            h('span', { class: 'Key' }, '⇧⏎'),
            h('span', { class: 'Dim' }, ' newline'),
          ),
          h(
            'div',
            null,
            h('span', { class: 'Key' }, 'PgUp'),
            h('span', { class: 'Dim' }, ' scroll'),
          ),
          h(
            'div',
            null,
            h('span', { class: 'Key' }, '^C'),
            h('span', { class: 'Dim' }, ' quit'),
          ),
        ),
    },
  ]
  return h(
    Frame,
    { sidebar },
    h('div', { class: 'Title' }, '@yaks/tui demo'),
    h(
      Scroll,
      { id: 'log', grow: '1' },
      ...lines.map((l, i) => h('div', { key: i }, l)),
    ),
    h(Textarea, {
      max: 6,
      onSubmit: (text: string) =>
        setLines((
          was,
        ) => [...was, ...text.split('\n').map((l) => `you: ${l}`)]),
    }),
  )
}

if (import.meta.main) await run(App)
