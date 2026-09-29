/**
 * `Inspect.Fields`: every value an entity holds, nothing hidden. The spine
 * first (its eid, its number, its archetype), then each component whole: a
 * row per property it stores or declares, so a component just added shows
 * the properties it can be given before it holds any.
 *
 * Where the host's controls take input, everything the vocabulary lets a
 * client write is written in place: each writable property through
 * @yaks/render's editor for its type, a component removed by its ×, one the
 * entity lacks added from the list under the rows, and the entity deleted by
 * two presses. What the server owns (a `stamped` or `computed` property, a
 * component that is not `wire`) is shown and never offered.
 *
 * @module
 */

import { h, type VNode } from 'preact'
import { render as mount } from '@yaks/preact'
import { define, editors, type Registry, type Renderer } from '@yaks/render'
import { Button, Chip, Edit, Pairs, Value } from '@yaks/ui'
import type { Prop, Vocab } from '@yaks/vocab'
import type { Bundle, Io, Props } from './host.ts'
import { refused, section, write } from './page.ts'
import { comp, comps, face, named, shape, tone } from './read.ts'

let { Key, Value: Cell } = Pairs

let VIEW = 'Inspect.Fields'

// A write from this section: a refusal is said under its title.
let put = (io: Io, e: Bundle, change: Bundle[]) =>
  write(io, e.entity.eid, VIEW, change)

// One registry of editors per vocabulary: the editors read it to pick each
// property's control.
let registries = new WeakMap<Vocab, Registry<Renderer>>()
let editing = (io: Io): Registry<Renderer> => {
  let r = registries.get(io.vocab)
  if (!r) registries.set(io.vocab, r = define(editors(io.vocab, io.editing)))
  return r
}

/** A stored value as it reads: a reference as the name of what it names,
 * linked, beside its eid; anything else coloured by its shape. */
export let shown = (io: Io, v: unknown, p?: Prop): VNode =>
  p?.category == 'ref' && typeof v == 'string' && v
    ? h(
      'span',
      {},
      h('a', { href: io.link(v) }, io.name(v)),
      ' ',
      h(Value, { mod: 'id' }, v),
    )
    : h(Value, { mod: shape(v) }, face(v))

// Whether a client may write this component at all.
let wire = (io: Io, name: string) => {
  let c = io.vocab.comp(name)
  return io.edits && !!c?.wire && !c.computed
}

// A property's value, in its editor where it may be written.
let value = (io: Io, e: Bundle, name: string, prop: string, v: unknown) => {
  let p = io.vocab.prop(name, prop)
  if (!p || !wire(io, name) || p.stamped || p.computed) return shown(io, v, p)
  let control = mount(editing(io), e, 'Edit', io.vocab, {
    comp: name,
    prop,
    onPatch: (patch) =>
      put(io, e, [{ entity: { eid: e.entity.eid }, ...patch }]),
    onError: (err) => refused(io, e.entity.eid, VIEW, err),
  })
  return p.category == 'ref' && typeof v == 'string' && v
    ? h('span', {}, h('a', { href: io.link(v) }, io.name(v)), ' ', control)
    : control
}

// A component's name in its hue, and the × that removes it where it may be.
let head = (name: string, prop?: string) =>
  h(
    Key,
    { key: `k ${name}.${prop ?? ''}` },
    h(Chip, { mod: tone(name) }, name),
    prop ? `.${prop}` : '',
  )

let remove = (io: Io, e: Bundle, name: string) =>
  wire(io, name)
    ? h(Button, {
      type: 'button',
      mod: ['quiet', 'danger'],
      'aria-label': `remove ${name}`,
      title: `remove ${name}`,
      onClick: () =>
        put(io, e, [{ entity: { eid: e.entity.eid }, [name]: null }]),
    }, '×')
    : null

// Each component's rows: what it stores, and what it declares but does not
// hold yet. A component with no properties is one row saying it is there.
let rowsOf = (
  io: Io,
  e: Bundle,
  name: string,
  row: Record<string, unknown>,
) => {
  let props = [...new Set([...Object.keys(row), ...io.vocab.props(name)])]
  if (!props.length) {
    return [
      head(name),
      h(
        Cell,
        { key: `v ${name}` },
        h(Edit, {}, 'present'),
        remove(io, e, name),
      ),
    ]
  }
  return props.flatMap((prop, i) => [
    head(name, prop),
    h(
      Cell,
      { key: `v ${name}.${prop}` },
      value(io, e, name, prop, row[prop]),
      i == 0 ? remove(io, e, name) : null,
    ),
  ])
}

// The spine: what every entity is, before any component.
let spine = (io: Io, e: Bundle) => {
  let s = comp(e, 'entity')
  return [
    h(Key, { key: 'k eid' }, 'eid'),
    h(Cell, { key: 'v eid' }, h(Value, { mod: 'id' }, e.entity.eid)),
    ...s.num != null
      ? [
        h(Key, { key: 'k num' }, 'num'),
        h(Cell, { key: 'v num' }, h(Value, { mod: 'num' }, face(s.num))),
      ]
      : [],
    ...named(s.archetype)
      ? [
        h(Key, { key: 'k archetype' }, 'archetype'),
        h(
          Cell,
          { key: 'v archetype' },
          h('a', { href: io.link(s.archetype) }, io.name(s.archetype)),
        ),
      ]
      : [],
  ]
}

// The components a client may add that the entity lacks.
let addable = (io: Io, e: Bundle): string[] => {
  let has = new Set(comps(e).map(([n]) => n))
  return io.vocab.comps.filter((n) => !has.has(n) && wire(io, n))
}

let Add = ({ e, io }: { e: Bundle; io: Io }) =>
  h(
    'select',
    {
      class: 'Edit',
      'aria-label': 'add a component',
      value: '',
      onChange: (ev: Event & { currentTarget: HTMLSelectElement }) => {
        let name = ev.currentTarget.value
        if (name) put(io, e, [{ entity: { eid: e.entity.eid }, [name]: {} }])
      },
    },
    h('option', { value: '' }, '+ component'),
    addable(io, e).map((n) => h('option', { key: n, value: n }, n)),
  )

// Deleting takes two presses: the first arms it, in the page's own graph.
let Delete = ({ e, io }: { e: Bundle; io: Io }) => {
  let eid = e.entity.eid
  let armed = !!comp(io.state(eid), 'lens').armed
  let arm = (armed: boolean) => io.set([{ entity: { eid }, lens: { armed } }])
  return armed
    ? h(
      'span',
      {},
      h(Button, {
        type: 'button',
        mod: 'danger',
        onClick: () => {
          arm(false)
          put(io, e, [{ entity: { eid }, $delete: true }])
        },
      }, `delete ${io.id(e)}`),
      ' ',
      h(Button, {
        type: 'button',
        mod: 'quiet',
        onClick: () => arm(false),
      }, 'keep'),
    )
    : h(
      Button,
      { type: 'button', mod: 'danger', onClick: () => arm(true) },
      'delete',
    )
}

let Body = ({ e, io }: Props) =>
  h(
    'div',
    {},
    h(
      Pairs,
      {},
      spine(io, e),
      comps(e).flatMap(([name, row]) => rowsOf(io, e, name, row)),
    ),
    io.edits
      ? h(
        'div',
        { class: 'Inspect_Actions' },
        h(Add, { e, io }),
        h(Delete, { e, io }),
      )
      : null,
  )

/** Every value an entity holds, written in place where it may be. */
export let fields = section({
  view: VIEW,
  match: true,
  title: 'Fields',
  count: ({ e }) => comps(e).length,
  Body,
})
