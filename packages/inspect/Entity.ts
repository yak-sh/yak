/**
 * An entity, as the inspector shows it: its head (its name, id and kind, and
 * what every entity is before any component: its eid and its archetype),
 * then a small table of its values for each component it carries, that
 * component's description under the component's name, then its edges and
 * its history (./Edges.ts, ./History.ts).
 *
 * Everything the vocabulary lets a client write is written in place: each
 * value changed where it stands (./value.ts), a component removed by its ×, one the entity
 * lacks added from the head, and the entity deleted by two presses.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Button, Head, Rows, Value } from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { Cell } from './value.ts'
import { Edges } from './Edges.ts'
import { Grid } from './grid.ts'
import { chip } from './links.ts'
import { History } from './History.ts'
import {
  about,
  NoteButton,
  Part,
  Said,
  under,
  useNamed,
  useNotes,
} from './notes.ts'
import { comp, comps, named, writable } from './read.ts'
import { key, me, put, refusal, write } from './state.ts'

// The components a client may add that the entity lacks.
let addable = (io: Io, e: Bundle): string[] => {
  let has = new Set(comps(e).map(([n]) => n))
  return io.vocab.comps.filter((n) => !has.has(n) && writable(io, n))
}

let Add = ({ e, io }: { e: Bundle; io: Io }) =>
  h(
    'select',
    {
      class: 'Edit Edit-fit',
      'aria-label': 'add a component',
      value: '',
      onChange: (ev: Event & { currentTarget: HTMLSelectElement }) => {
        let name = ev.currentTarget.value
        let eid = e.entity.eid
        if (name) write(io, eid, [{ entity: { eid }, [name]: {} }])
      },
    },
    h('option', { value: '' }, '+ component'),
    addable(io, e).map((n) => h('option', { key: n, value: n }, n)),
  )

// Deleting takes two presses: the first arms it, in the page's own graph.
let Delete = ({ e, io }: { e: Bundle; io: Io }) => {
  let eid = e.entity.eid
  let armed = me(io).armed == eid
  return armed
    ? h(
      'span',
      {},
      h(Button, {
        type: 'button',
        mod: 'danger',
        onClick: () => {
          io.set(put({ armed: null }))
          write(io, eid, [{ entity: { eid }, $delete: true }])
        },
      }, `delete ${io.id(e)}`),
      h(Button, {
        type: 'button',
        mod: 'quiet',
        onClick: () => io.set(put({ armed: null })),
      }, 'keep'),
    )
    : h(Button, {
      type: 'button',
      mod: ['quiet', 'danger'],
      onClick: () => io.set(put({ armed: eid })),
    }, 'delete')
}

/** What an entity's head is drawn with. */
type Top = { e: Bundle; io: Io; notes: Map<string, Bundle[]> }

/** An entity's head: its name, id and kind, its eid and archetype, and, where
 * it may be changed, a component to add and its delete. */
export let EntityHead = ({ e, io, notes }: Top): JSX.Element => {
  let eid = e.entity.eid
  let s = comp(e, 'entity')
  let subject = about(io, e)
  let said = refusal(io, eid)
  return h(
    'div',
    {},
    h(
      Head,
      {},
      h(
        Head.Title,
        {},
        io.name(eid),
        io.name(eid) != io.id(e) ? h(Head.Id, {}, io.id(e)) : null,
        h(Head.Kind, {}, io.kind(e)),
        h(NoteButton, { io, eid, heading: '', subject }),
      ),
      said ? h(Head.Sub, { mod: 'refused' }, said) : null,
      h(
        Head.Facts,
        {},
        h(Value, { mod: 'id' }, eid),
        ...named(s.archetype)
          ? [
            h(
              'a',
              { href: io.find(`.entity.archetype=${s.archetype}`) },
              'archetype',
            ),
          ]
          : [],
        ...io.edits ? [h(Add, { e, io }), h(Delete, { e, io })] : [],
      ),
    ),
    h(Said, { io, eid, subject, heading: '', notes: notes.get('') }),
  )
}

/** One component of an entity: a row per property it stores or declares, so
 * a component just added shows what it can be given before it holds any. */
export let CompTable = (
  { e, io, name, notes }: {
    e: Bundle
    io: Io
    name: string
    notes: Map<string, Bundle[]>
  },
): JSX.Element => {
  let eid = e.entity.eid
  let row = comp(e, name)
  let props = [...new Set([...Object.keys(row), ...io.vocab.props(name)])]
  let refs = props.filter((p) => io.vocab.prop(name, p)?.category == 'ref')
  useNamed(io, refs.map((p) => row[p] as string))
  let remove = writable(io, name)
    ? h(Button, {
      type: 'button',
      mod: ['quiet', 'danger'],
      'aria-label': `remove ${name}`,
      title: `remove ${name}`,
      onClick: () => write(io, eid, [{ entity: { eid }, [name]: null }]),
    }, '×')
    : null
  let pairs = props.map((prop): Bundle => ({ entity: { eid: prop } }))
  return h(
    Part,
    {
      io,
      eid,
      subject: about(io, e),
      heading: name,
      title: chip(io, name),
      act: remove,
      sub: io.vocab.comp(name)?.description,
      notes,
    },
    props.length
      ? h(Grid, {
        io,
        id: key(eid, name),
        pick: false,
        local: true,
        rows: pairs,
        columns: [
          { name: 'property', mod: 'key', cell: (p) => p.entity.eid },
          {
            name: 'value',
            cell: (p) => h(Cell, { io, e, name, prop: p.entity.eid }),
          },
        ],
      })
      : h(Rows.More, {}, 'no properties: it is there, or not'),
  )
}

// The headings an entity's page holds, for its notes.
let headings = (e: Bundle) => [...comps(e).map(([n]) => n), 'Edges', 'History']

/** An entity's own page. */
export let EntityPage = ({ e, io }: Props): JSX.Element => {
  let notes = under(useNotes(io, e.entity.eid), about(io, e), headings(e))
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    h(EntityHead, { e, io, notes }),
    comps(e).map(([name]) => h(CompTable, { key: name, e, io, name, notes })),
    h(Edges, { e, io, notes }),
    h(History, { e, io, notes }),
  )
}

/** Any entity's page. */
export let entityViews: View[] = [
  { view: 'Inspect.Page', match: true, Render: EntityPage },
]
