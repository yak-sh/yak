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

import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { Button, Rows, Value } from '@yaks/ui'
import type { Prop } from '@yaks/vocab'
import type { Bundle, Io, Props, View } from './host.ts'
import { useCensus } from './census.ts'
import { usePageNotes } from './Entity.ts'
import { Grid, SIZE } from './grid.ts'
import { History } from './History.ts'
import { chip, compEid } from './schema.ts'
import { Part, useNamed } from './notes.ts'
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

// Whether the graph ranks this property's values: text, enum, id and number.
let ranks = (p?: Prop) =>
  !!p &&
  (p.category != 'scalar' ||
    ['text', 'url', 'query', 'number', 'priority'].includes(p.scalar!))

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

// What the head says under the property's name: what it is, then whose it
// is, its type and what is special about it.
let about = (io: Io, e: Bundle): ComponentChildren[] => {
  let [name] = split(e)
  let p = comp(e, '_prop')
  let pkg = str(e, '_prop', 'package')
  let ref = str(e, '_prop', 'ref')
  let listed = (k: string) => p[k] != null ? [` · ${k} ${face(p[k])}`] : []
  return [
    str(e, 'doc', 'body'),
    h('br', {}),
    'of ',
    chip(io, name),
    pkg ? [' from ', h('a', { href: io.link(pkg) }, io.name(pkg))] : '',
    ' · ',
    typed({ ...p, ref: null }) || 'untyped',
    ref ? [' → ', ref == 'entity' ? 'any entity' : chip(io, ref)] : '',
    ...flags(p).map((f) => ` · ${f}`),
    ...['enum', 'default', 'death'].flatMap(listed),
  ]
}

// The values it holds, most common first.
let Values = ({ e, io, notes }: Part_) => {
  let eid = e.entity.eid
  let [name, prop] = split(e)
  let p = io.vocab.prop(name, prop)
  let id = key(eid, 'Values')
  let census = useCensus(io)
  let n = census.ready ? census.carried[name] ?? 0 : undefined
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
  let numbered = ['number', 'priority'].includes(p?.scalar ?? '')
  let page = grid(io, id).after?.length ?? 0
  useNamed(io, ref ? values.slice(page * SIZE, (page + 1) * SIZE) : [])
  let body = !ranks(p)
    ? h(Rows.More, {}, 'the graph ranks only text, enum, id and number values')
    : !ranked
    ? waiting({ rows: [], ready: census.ready, error: census.error }) ?? h(
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
                h(Value, { mod: numbered ? 'num' : 'text' }, line(v, 120)),
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
  let notes = usePageNotes(io, e, HEADINGS)
  let [name, prop] = split(e)
  useNamed(io, [str(e, '_prop', 'package')])
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', {
      sub: about(io, e),
      notes: notes.get(''),
      subject,
    }),
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
