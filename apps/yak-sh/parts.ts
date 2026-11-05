// The parts of the page below the story, each drawn from its section doc: a
// numbered heading on the left with what it says, and what it holds on the
// right. A part's body is markdown: the heading's words, a rule, then what it
// holds, where an `sh` block is commands to copy, a `ts` block is a file, and a
// `###` heading starts a numbered item. The title block signs the page off.
import { type FunctionComponent, h } from 'preact'
import { useState } from 'preact/hooks'
import { Prose, words } from './prose.ts'
import type { Bundle } from '@yaks/graph'
import type { Ctx } from './views.ts'
import { text } from './told.ts'
import { ANCHORS } from './site.ts'
import { Logo } from './idle.ts'

/** A command with a button that copies it. */
export let Copy = ({ line }: { line: string }) => {
  let [done, set] = useState(false)
  return h('div', { class: 'Copy' }, [
    h('code', null, [h('span', { class: 'Copy_Sign' }, '$ '), line]),
    h('button', {
      type: 'button',
      onClick: () =>
        navigator.clipboard?.writeText(line).then(() => {
          set(true)
          setTimeout(() => set(false), 1500)
        }),
    }, done ? 'Copied' : 'Copy'),
  ])
}

/** A piece of what a part holds. */
export type Piece =
  | { kind: 'md'; text: string }
  | { kind: 'sh'; lines: string[] }
  | { kind: 'file'; name: string; text: string }
  | { kind: 'item'; title: string }

/** A part's body as its heading's words and the pieces it holds, in order. */
export let partOf = (body: string) => {
  let at = body.indexOf('\n\n---\n\n')
  let head = at < 0 ? body : body.slice(0, at)
  let held = at < 0 ? '' : body.slice(at + 7)
  let pieces: Piece[] = []
  let prose = (s: string) => {
    for (let chunk of s.split(/^(### .*)$/m)) {
      if (chunk.startsWith('### ')) {
        pieces.push({ kind: 'item', title: chunk.slice(4).trim() })
      } else if (chunk.trim()) pieces.push({ kind: 'md', text: chunk.trim() })
    }
  }
  let last = 0
  for (let m of held.matchAll(/```(\w+)( [^\n]*)?\n([\s\S]*?)\n```/g)) {
    prose(held.slice(last, m.index))
    last = m.index! + m[0].length
    let [, lang, name = '', code] = m
    pieces.push(
      lang == 'sh'
        ? { kind: 'sh', lines: code.split('\n').filter(Boolean) }
        : { kind: 'file', name: name.trim() || lang, text: code },
    )
  }
  prose(held.slice(last))
  return { head, pieces }
}

let piece = (p: Piece) =>
  p.kind == 'md' ? h(Prose, { source: p.text }) : p.kind == 'sh'
    ? h(
      'div',
      { class: 'Part_Lines' },
      p.lines.map((line) => h(Copy, { line })),
    )
    : p.kind == 'file'
    ? h('div', { class: 'File' }, [
      h('div', { class: 'File_Bar' }, p.name),
      h('pre', null, h('code', null, p.text)),
    ])
    : null

// What a part holds: the pieces before its first item, then its items as a
// numbered list.
let held = (pieces: Piece[]) => {
  let loose = pieces.findIndex((p) => p.kind == 'item')
  let before = loose < 0 ? pieces : pieces.slice(0, loose)
  let items: { title: string; pieces: Piece[] }[] = []
  for (let p of loose < 0 ? [] : pieces.slice(loose)) {
    if (p.kind == 'item') items.push({ title: p.title, pieces: [] })
    else items.at(-1)!.pieces.push(p)
  }
  return [
    ...before.map(piece),
    items.length
      ? h(
        'ol',
        { class: 'Part_List' },
        items.map((it) =>
          h('li', null, [
            h('h3', null, words(it.title)),
            ...it.pieces.map(piece),
          ])
        ),
      )
      : null,
  ]
}

let Part: FunctionComponent<Ctx & { e: Bundle }> = ({ e, yak }) => {
  let eid = e.entity.eid
  // Its number: its place among the page's parts.
  let parts = yak.rows()
    .filter((b) => text(b, 'pane', 'view') == 'Part')
    .sort((a, b) =>
      Number(text(a, 'pane', 'order')) - Number(text(b, 'pane', 'order'))
    )
    .map((b) => text(b, 'pane', 'content'))
  let { head, pieces } = partOf(text(e, 'doc', 'body'))
  return h('section', { class: 'Part', id: ANCHORS[eid], 'data-eid': eid }, [
    h('div', { class: 'Part_Head' }, [
      h('span', { class: 'Bubble' }, String(parts.indexOf(eid) + 1)),
      h('h2', null, words(text(e, 'doc', 'title'))),
      h(Prose, { source: head }),
    ]),
    h('div', { class: 'Part_Body' }, held(pieces)),
  ])
}

/** The title block: the site's name and line, then `- term: value` lines. */
let Block: FunctionComponent<Ctx & { e: Bundle }> = ({ e }) => {
  let [line, ...rest] = text(e, 'doc', 'body').split('\n')
  let facts = rest.flatMap((l) => {
    let m = l.match(/^- ([^:]+): (.*)$/)
    return m ? [[m[1], m[2]]] : []
  })
  return h('footer', { class: 'Block', 'data-eid': e.entity.eid }, [
    h('div', { class: 'Block_Sign' }, [
      h(Logo, {
        class: 'Block_Logo',
        sizes: '(max-width: 760px) 60vw, 30vw',
        width: 440,
        height: 440,
        loading: 'lazy',
      }),
      h('strong', null, words(text(e, 'doc', 'title'))),
      h('span', null, words(line)),
    ]),
    h(
      'div',
      { class: 'Block_Facts' },
      facts.map(([term, value]) =>
        h('dl', null, [
          h('dt', null, term),
          h('dd', null, h(Prose, { source: value })),
        ])
      ),
    ),
  ])
}

/** The views this module draws, for views.ts's registry. */
export let parts = [
  { view: 'Part', Render: Part },
  { view: 'Block', Render: Block },
]
