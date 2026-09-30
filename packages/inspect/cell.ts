/**
 * A stored value where it can be changed. Pressed, it is typed over where it
 * stands: the same element, made `contenteditable`, so nothing else on the
 * page moves. Enter, or leaving it, writes what was typed, read as its
 * property's type says (@yaks/render `edit`); Escape puts it back; a refusal
 * marks the value, saying why when pointed at. Which value is being typed
 * over is the page's own state (./state.ts `edit`).
 *
 * A value the vocabulary keeps from clients (a `stamped` or `computed`
 * property, a component that is not `wire`), and every value where the host's
 * controls take no input (a terminal), is shown and never offered. A
 * reference reads as the name of what it names, linked, beside its id.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { edit } from '@yaks/render'
import { Value } from '@yaks/ui'
import type { Prop } from '@yaks/vocab'
import type { Bundle, Io } from './host.ts'
import { comp, face, named, shape } from './read.ts'
import { key, me, put, refusal, write } from './state.ts'

/** Whether a client may write this component, or this property of it,
 * here. */
export let writable = (io: Io, name: string, prop?: string): boolean => {
  let c = io.vocab.comp(name)
  if (!io.edits || !c?.wire || c.computed) return false
  let p = prop == null ? undefined : io.vocab.prop(name, prop)
  return prop == null || (!!p && !p.stamped && !p.computed)
}

// A reference, as the id a person types: `T-9` where the host holds it.
let idOf = (io: Io, eid: string) => {
  let b = io.get(eid)
  return b ? io.id(b) : eid
}

// The name a reference reads as, linked to its page.
let far = (io: Io, eid: string) => h('a', { href: io.link(eid) }, io.name(eid))

/** A stored value as it reads: a reference as the name of what it names,
 * linked, beside its id; anything else coloured by its shape. */
export let shown = (io: Io, v: unknown, p?: Prop): JSX.Element =>
  p?.category == 'ref' && named(v)
    ? h('span', {}, far(io, v), ' ', h(Value, { mod: 'id' }, idOf(io, v)))
    : h(Value, { mod: shape(v) }, face(v))

// What typing over a value starts from.
let source = (io: Io, v: unknown, p?: Prop): string =>
  v == null
    ? ''
    : p?.category == 'ref' && named(v)
    ? idOf(io, v)
    : typeof v == 'object'
    ? JSON.stringify(v)
    : String(v)

// What a value that can be typed over says when pointed at.
let hint = (p?: Prop) =>
  p?.values ? `one of ${p.values.join(', ')}` : p?.description

/** What a cell is drawn with: the entity, and which of its values. */
export type CellProps = { io: Io; e: Bundle; name: string; prop: string }

/** One value of an entity, typed over in place where it may be. */
export let Cell = ({ io, e, name, prop }: CellProps): JSX.Element => {
  let eid = e.entity.eid
  let v = comp(e, name)[prop]
  let p = io.vocab.prop(name, prop)
  let at = key(eid, name, prop)
  let editing = me(io).edit == at
  let el = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    let node = el.current
    if (!editing || !node?.focus) return
    node.focus()
    globalThis.getSelection?.()?.selectAllChildren(node)
  }, [editing])
  if (!writable(io, name, prop)) return shown(io, v, p)
  let was = source(io, v, p)
  // Leave the value: write what was typed, unless it was put back.
  let done = (keep: boolean) => {
    let node = el.current
    if (me(io).edit != at || !node) return
    io.set(put({ edit: null }))
    let typed = node.textContent ?? ''
    if (!keep || typed == was) return
    let patch
    try {
      patch = edit(io.vocab, { comp: name, prop }, io.editing).run(e, typed)
    } catch (err) {
      return io.set(put({ said: (err as Error).message, at }))
    }
    write(io, at, [{ entity: { eid }, ...patch }])
  }
  let said = refusal(io, at)
  let value = h(Value, {
    key: editing ? 'editing' : 'shown',
    elRef: el,
    mod: [shape(v), 'editable', editing && 'editing', said && 'refused'],
    contentEditable: editing ? 'plaintext-only' : undefined,
    tabIndex: 0,
    role: 'textbox',
    'aria-label': `${name}.${prop}`,
    title: said || hint(p),
    onClick: () => editing || io.set(put({ edit: at })),
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key == 'Escape') done(false)
      else if (ev.key != 'Enter' || ev.shiftKey) return
      else if (editing) done(true)
      else io.set(put({ edit: at }))
      ev.preventDefault()
    },
    // Only the element typed in writes when it is left: the one it replaced
    // loses the focus as it goes, holding nothing typed.
    onBlur: editing ? () => done(true) : undefined,
  }, editing ? was : face(v))
  return p?.category == 'ref' && named(v)
    ? h('span', {}, far(io, v), ' ', value)
    : value
}
