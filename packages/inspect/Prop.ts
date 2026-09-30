/**
 * A property's page (`_prop`, @yaks/vocab): what it is and holds; the values
 * it holds, most common first, with how many entities hold each; and the
 * recent writes of its component that touched it.
 *
 * Ranking values is a tally over every entity carrying the component, asked
 * once. Where the vocabulary bounds the values (an enum), or few entities
 * carry the component, it is asked as the page opens; otherwise a press asks
 * it, since a tally over a free-text property of many entities is as large
 * as the entities are many (README, Limits).
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { Button, Head, Rows, Value } from '@yaks/ui'
import type { Prop } from '@yaks/vocab'
import type { Bundle, Io, Props, View } from './host.ts'
import { Grid, SIZE } from './grid.ts'
import { History } from './History.ts'
import { chip, compEid } from './links.ts'
import { NoteButton, Part, Said, under, useNamed, useNotes } from './notes.ts'
import { comp, count, face, flags, line, named, str, typed } from './read.ts'
import { waiting } from './rows.ts'
import { grid, key, turned } from './state.ts'

/** How many entities may carry a component before ranking its values waits
 * for a press. */
export let RANKED = 5000

let HEADINGS = ['Values', 'Recent writes']

// A property's component and its own name.
let split = (e: Bundle): [string, string] => {
  let [name, ...rest] = str(e, 'doc', 'title').split('.')
  return [name, rest.join('.') || str(e, '_prop', 'name')]
}

// Whether the graph ranks this property's values: text, enum and id only.
let ranks = (p?: Prop) =>
  !!p &&
  (p.category != 'scalar' || ['text', 'url', 'query'].includes(p.scalar!))

/**
 * A value as a query term: bare where it is one word, quoted otherwise.
 *
 * ```ts
 * import { quoted } from './Prop.ts'
 * quoted('open') // 'open'
 * quoted('two words') // '"two words"'
 * quoted('say "hi"') // "'say \"hi\"'"
 * ```
 */
export let quoted = (v: string): string =>
  /^[\w.:@#-]+$/.test(v) ? v : v.includes('"') ? `'${v}'` : `"${v}"`

type Part_ = { e: Bundle; io: Io; notes: Map<string, Bundle[]> }

let Top = ({ e, io, notes }: Part_) => {
  let eid = e.entity.eid
  let [name] = split(e)
  let p = comp(e, '_prop')
  let pkg = str(e, '_prop', 'package')
  let subject = str(e, 'doc', 'title')
  useNamed(io, [pkg])
  let listed = (k: string) =>
    p[k] != null ? [h('span', {}, `${k} ${face(p[k])}`)] : []
  return h(
    'div',
    {},
    h(
      Head,
      {},
      h(
        Head.Title,
        {},
        subject,
        h(Head.Kind, {}, 'property'),
        h(NoteButton, { io, eid, heading: '', subject }),
      ),
      h(Head.Sub, {}, str(e, 'doc', 'body')),
      h(
        Head.Facts,
        {},
        h('span', {}, 'of ', chip(io, name)),
        pkg ? h('a', { href: io.link(pkg) }, io.name(pkg)) : 'no package',
        h('span', {}, typed(p) || 'untyped'),
        ...flags(p).map((f) => h('span', {}, f)),
        ...['enum', 'default', 'death'].flatMap(listed),
      ),
    ),
    h(Said, { io, eid, subject, heading: '', notes: notes.get('') }),
  )
}

// The values it holds, most common first.
let Values = ({ e, io, notes }: Part_) => {
  let eid = e.entity.eid
  let [name, prop] = split(e)
  let p = io.vocab.prop(name, prop)
  let id = key(eid, 'Values')
  let got = io.ask({ total: { query: `.${name}&.count`, once: true } })
  let n = got.total?.count
  let ranked = ranks(p) &&
    (p?.category == 'enum' || !!grid(io, id).rank || (n != null && n <= RANKED))
  let tallied = io.ask(
    ranked
      ? { tally: { query: `.${name}&.tally=${name}.${prop}`, once: true } }
      : {},
  )
  let tally = tallied.tally?.tally ?? {}
  let values = Object.keys(tally).toSorted((a, b) => tally[b] - tally[a])
  let ref = p?.category == 'ref'
  let page = grid(io, id).after?.length ?? 0
  useNamed(io, ref ? values.slice(page * SIZE, (page + 1) * SIZE) : [])
  let body = !ranks(p)
    ? h(Rows.More, {}, 'the graph ranks only text, enum and id values')
    : !ranked
    ? waiting(got.total) ?? h(
      Rows.More,
      {},
      `${count(n ?? 0)} entities carry ${name}; ranking what they hold here ` +
        'reads every one. ',
      h(Button, {
        type: 'button',
        mod: 'quiet',
        onClick: () => io.set(turned(id, { rank: true })),
      }, 'rank them'),
    )
    : waiting(tallied.tally) ?? h(Grid, {
      io,
      id,
      local: true,
      rows: values.map((v): Bundle => ({ entity: { eid: v } })),
      pick: ref ? (b) => named(b.entity.eid) ? b.entity.eid : undefined : false,
      columns: [
        {
          name: 'value',
          cell: (b) => {
            let v = b.entity.eid
            return ref && named(v)
              ? h('a', { href: io.link(v) }, io.name(v))
              : h(
                'a',
                { href: io.find(`.${name}.${prop}=${quoted(v)}`) },
                h(Value, { mod: 'text' }, line(v, 120)),
              )
          },
        },
        {
          name: 'entities',
          mod: 'num',
          cell: (b) => count(tally[b.entity.eid] ?? 0),
        },
      ],
    })
  return h(
    Part,
    {
      io,
      eid,
      subject: str(e, 'doc', 'title'),
      heading: 'Values',
      count: tallied.tally?.tally ? values.length : undefined,
      notes,
    },
    body,
  )
}

/** A property's own page. */
export let PropPage = ({ e, io }: Props): JSX.Element => {
  let subject = str(e, 'doc', 'title')
  let notes = under(useNotes(io, e.entity.eid), subject, HEADINGS)
  let [name, prop] = split(e)
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    h(Top, { e, io, notes }),
    h(Values, { e, io, notes }),
    h(History, {
      e,
      io,
      notes,
      heading: 'Recent writes',
      where: `comp=${compEid(name)}`,
      prop,
      once: true,
    }),
  )
}

/** A property's page. */
export let propViews: View[] = [
  { view: 'Inspect.Page', match: parse('._prop'), Render: PropPage },
]
