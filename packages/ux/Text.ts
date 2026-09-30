/**
 * A value typed over where it stands: `Edit.Text`. At rest it is the value's
 * text (or its inline markdown); opened, by a double-click or by whoever holds
 * its `Edit` state, the element becomes plaintext-editable in place, the same
 * face, font and box, so nothing on the page moves. Enter (a body: leaving it)
 * emits what was typed, Escape puts the value back, and what is typed is kept
 * in the page's graph as it is typed, so a remount types on from it.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { Edit as Span } from '@yaks/ui'
import { type Bundle, useHost } from './host.ts'
import { emit, type OnChange } from './emit.ts'
import { useEdit } from './live.ts'
import { isBody } from './read.ts'
import { valueOf } from './state.ts'

// The source a value is typed over as: a JSON value as its JSON text.
let source = (v: unknown) =>
  v == null ? '' : typeof v == 'object' ? JSON.stringify(v) : String(v)

/** What an `Edit.Text` is drawn with. */
export type TextProps = {
  /** what controls it: the value is `e[comp][prop]` */
  e: Bundle
  comp: string
  prop: string
  /** where what it emits goes (default: the host's `write`) */
  onChange?: OnChange
  /** its `Edit` state's eid, when its caller names it */
  at?: string
  /** Enter types a new line; leaving it is what emits */
  multi?: boolean
  /** inline markdown at rest (the host's `markup`); its source typed over */
  inline?: boolean
  /** shown, never opened; an open one closes, emitting nothing */
  readOnly?: boolean
}

/** A value typed over where it stands. */
export let Text = (
  { e, comp, prop, onChange, at, multi, inline, readOnly }: TextProps,
): JSX.Element => {
  let host = useHost()
  let { vocab, markup } = host
  let edit = useEdit(e.entity.eid, comp, prop, at)
  let held = valueOf(e, comp, prop)
  // A body a bundle does not carry is one the page has not loaded, not an
  // empty one: typing over it would write a fragment over the stored text.
  let unloaded = held === undefined && isBody(vocab, comp, prop)
  let still = readOnly || unloaded
  let value = source(held)
  let open = !!edit.row?.open && !still
  let ref = useRef<HTMLElement>(null)
  let md = inline && markup

  // Opened, the element takes the keyboard, holding what was typed so far,
  // and says it is being typed in (the state's `text`).
  useLayoutEffect(() => {
    let t = ref.current
    if (!open || !t) return
    let row = t.closest<HTMLElement>('[draggable="true"]')
    if (row) row.draggable = false
    let text = edit.row?.text ?? value
    t.contentEditable = 'plaintext-only'
    if (md || text != value) t.textContent = text
    t.focus()
    globalThis.getSelection?.()?.setPosition(t, t.childNodes.length)
    if (edit.row?.text == null) edit.type(text)
    return () => {
      if (row) row.draggable = true
    }
  }, [open])

  // Read-only while open (a permission change): it closes, emitting nothing.
  useLayoutEffect(() => {
    if (still && edit.row?.open) edit.end()
  }, [still])

  // Leaving it emits. Being taken off the page (a remount) is not leaving
  // it: a browser blurs the focused element as it removes it, so finishing
  // waits a microtask and asks whether it is still there, and the draft stays
  // in the graph for the remount.
  let finish = (t: HTMLElement) =>
    queueMicrotask(() => {
      if (!t.isConnected || !t.isContentEditable || !edit.now()?.open) return
      let text = (t.textContent ?? '').trim()
      if (text && text != value) emit(host, onChange, e, comp, prop, text)
      edit.end()
    })

  let key = (ev: KeyboardEvent) => {
    let t = ev.currentTarget as HTMLElement
    if (!t.isContentEditable) return
    if (ev.key == 'Enter' && !multi) {
      ev.preventDefault()
      t.blur() // what is typed is emitted on leaving: one path
    } else if (ev.key == 'Escape') {
      t.textContent = value
      t.blur()
    }
  }

  // Open and at rest are two elements: the one typed in is dropped whole
  // when it closes, so the value paints fresh however the typing left it.
  return h(Span, {
    key: open ? 'open' : 'rest',
    elRef: ref,
    onDblClick: () => still || open || edit.begin(),
    onKeyDown: key,
    onInput: (ev: InputEvent) =>
      edit.type((ev.currentTarget as HTMLElement).textContent ?? ''),
    onBlur: (ev: FocusEvent) => finish(ev.currentTarget as HTMLElement),
    ...md ? { dangerouslySetInnerHTML: { __html: md(value) } } : {},
  }, md ? null : value)
}
