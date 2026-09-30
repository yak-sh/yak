/**
 * A stored value on a page: shown as it was stored, coloured by its shape (a
 * reference as the name of what it names, linked, beside its id). Where a
 * client may write it, it is a @yaks/editors `Prop` wearing that face: pressed,
 * it is typed over where it stands, in the shape's own type so nothing moves,
 * or its choices float beside it; a reference's picker opens from a handle
 * beside its link. A value the vocabulary keeps from clients,
 * and every value where the host's controls take no input (a terminal), is
 * only shown.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Prop } from '@yaks/editors'
import { Value } from '@yaks/ui'
import type { Prop as Declared } from '@yaks/vocab'
import type { Bundle, Io } from './host.ts'
import { comp, face, named, shape, writable } from './read.ts'

// A reference, as the id a person types: `T-9` where the host holds it.
let idOf = (io: Io, eid: string) => {
  let b = io.get(eid)
  return b ? io.id(b) : eid
}

// The name a reference reads as, linked to its page.
let far = (io: Io, eid: string) => h('a', { href: io.link(eid) }, io.name(eid))

/** A stored value as it reads: a reference as the name of what it names,
 * linked, beside its id; anything else coloured by its shape. */
export let shown = (io: Io, v: unknown, p?: Declared): JSX.Element =>
  p?.category == 'ref' && named(v)
    ? h('span', {}, far(io, v), ' ', h(Value, { mod: 'id' }, idOf(io, v)))
    : h(Value, { mod: shape(v) }, face(v))

/** What a cell is drawn with: the entity, and which of its values. */
export type CellProps = { io: Io; e: Bundle; name: string; prop: string }

/** One value of an entity, changed where it stands where it may be. Its
 * shape is worn around the whole value, so what is typed over it keeps the
 * face's type. */
export let Cell = ({ io, e, name, prop }: CellProps): JSX.Element => {
  let v = comp(e, name)[prop]
  let p = io.vocab.prop(name, prop)
  if (!writable(io, name, prop)) return shown(io, v, p)
  let ref = p?.category == 'ref'
  // A reference's face is a link, so its picker opens from a handle beside it.
  let value = h(Prop, {
    eid: e.entity.eid,
    comp: name,
    prop,
    editable: true,
    handle: ref,
    show: (_, now) => shown(io, now, p),
  })
  let s = shape(v)
  return ref || s == 'nil' ? value : h(Value, { mod: s }, value)
}
