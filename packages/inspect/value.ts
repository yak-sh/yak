/**
 * A stored value on a page. Read, it is said the way a person reads it (`reads`):
 * a reference as the name of what it names, linked; a moment in words; a hash
 * as far as it tells one from another; a JSON value, a text cut to a line.
 * Edited, it is a @yaks/ux `Edit` showing the value as it was stored (`shown`):
 * pressed, it is typed over where it stands, in the shape's own type so nothing
 * moves, or its choices float beside it; a reference's picker opens from a
 * handle beside its link. A value the vocabulary keeps from clients is only
 * shown.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Edit } from '@yaks/ux'
import { Value } from '@yaks/ui'
import type { Prop as Declared } from '@yaks/vocab'
import type { Bundle, Io } from './host.ts'
import { brief, comp, face, line, named, shape, writable } from './read.ts'

/** An entity a value names: what it is called, linked to its page, the id a
 * person types where the pointer rests on it. */
export let mention = (io: Io, eid: string): JSX.Element => {
  let b = io.get(eid)
  return h(
    'a',
    { href: io.link(eid), title: b ? io.id(b) : undefined },
    io.name(eid),
  )
}

/** A stored value as it was stored: a reference as the entity it names;
 * anything else coloured by its shape. */
export let shown = (io: Io, v: unknown, p?: Declared): JSX.Element =>
  p?.category == 'ref' && named(v)
    ? mention(io, v)
    : h(Value, { mod: shape(v) }, face(v))

/** A stored value as a person reads it; nothing where it holds nothing. A text
 * kept as a blob (@yaks/blob's `store: 'blob'`), where a journal holds its
 * address rather than its words, links to the words. */
export let reads = (io: Io, v: unknown, p?: Declared): JSX.Element => {
  if (v == null) return h(Value, { mod: 'nil' })
  if (named(v) && (p?.category == 'ref' || !p)) return mention(io, v)
  if (p?.keywords.store == 'blob' && /^[0-9a-f]{64}$/.test(String(v))) {
    return h('a', { href: `/blob/${v}` }, 'the text')
  }
  let s = shape(v)
  let said = s == 'time'
    ? io.when(String(v))
    : s == 'json'
    ? line(face(v), 100)
    : typeof v == 'string'
    ? brief(line(v, 160))
    : face(v)
  return h(Value, { mod: s, title: s == 'time' ? String(v) : undefined }, said)
}

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
  let value = h(Edit, {
    e,
    comp: name,
    prop,
    editable: true,
    handle: ref,
    show: (_, now) => shown(io, now, p),
  })
  let s = shape(v)
  return ref || s == 'nil' ? value : h(Value, { mod: s }, value)
}
