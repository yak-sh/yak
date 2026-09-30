import { h, type JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { Edit as Span } from '@yaks/ui'
import { host } from './host.ts'
import { columnValue, isBody } from './read.ts'
import { write } from './write.ts'
import { drop, peek, save } from './drafts.ts'

// The source a value is typed over as: a JSON value as its JSON text.
let source = (v: unknown) =>
  v == null ? '' : typeof v == 'object' ? JSON.stringify(v) : String(v)

// The generic in-place editor: <Edit eid comp prop /> renders the prop's
// current value; double-click turns the SAME node plaintext-editable — no
// swap, no layout shift, just the caret and seam the [contenteditable]
// styles add. Enter or blur commits the one changed column through the
// host's write door; Escape (or an empty result) reverts. A draggable
// ancestor (a board row) pauses while editing so clicks place the cursor
// instead of starting a drag.
// multi: Enter inserts a newline instead of committing (blur commits).
// open: mount already editing — for hosts that swap rendered content for
// source (the markdown body), where there's no same-node dblclick to
// start from. onClose fires when the edit ends, commit or revert.
// inline: show inline markdown at rest (the host's `markup`), but edit and
// save its source.
// Keystrokes save a draft; blur spends it — so a hot swap mid-edit
// remounts, finds the draft, and resumes editing where typing stopped.
export type InlineEditProps = {
  eid: string
  comp: string
  prop: string
  multi?: boolean
  open?: boolean
  onClose?: () => void
  inline?: boolean
  readOnly?: boolean
}
export let InlineEdit = (
  { eid, comp, prop, multi, open, onClose, inline, readOnly }: InlineEditProps,
): JSX.Element => {
  let { vocab, want, markup, mode } = host()
  let held = columnValue(host().get(eid), comp, prop)
  // A host may hold a body back until asked (`want`): undefined is unloaded,
  // not empty. Seeding the editor from a value we don't have and committing
  // on blur would write a fragment over the stored body — so the editor stays
  // read-only until the body lands, and asking is what lands it.
  let unloaded = !!want && held === undefined && isBody(vocab, comp, prop)
  let value = source(held)
  let ref = useRef<HTMLElement>(null)
  let dkey = `${eid}.${comp}.${prop}`
  let md = inline && markup
  let rendered = md ? { dangerouslySetInnerHTML: { __html: md(value) } } : {}

  let begin = (t: HTMLElement) => {
    if (readOnly || unloaded || t.isContentEditable) return
    let row = t.closest<HTMLElement>('[draggable="true"]')
    if (row) row.draggable = false
    t.dataset.was = value
    if (md) t.textContent = value
    t.contentEditable = 'plaintext-only'
    t.focus()
    // caret at the end
    globalThis.getSelection?.()?.setPosition(t, t.childNodes.length)
    mode?.('insert')
  }

  useEffect(() => {
    let t = ref.current
    if (unloaded) return void want?.(eid, comp, prop)
    if (!t || t.isContentEditable || readOnly) return
    let d = peek(dkey) // a draft only exists mid-edit: resume it
    if (!open && !d) return
    begin(t) // records the COMMITTED value as `was` — Escape still reverts
    if (d) {
      t.textContent = d.v
      globalThis.getSelection?.()?.setPosition(t, t.childNodes.length)
    }
    // `unloaded` is a dependency because the body LANDS: an editor opened
    // over a deferred body arms itself the moment its text arrives.
  }, [open, unloaded, readOnly])

  let key = (ev: KeyboardEvent) => {
    let t = ev.currentTarget as HTMLElement
    if (!t.isContentEditable) return
    if (ev.key == 'Enter' && !multi) {
      ev.preventDefault()
      t.blur() // commit lives in blur — one path
    } else if (ev.key == 'Escape' && t.firstChild?.nodeType == 3) {
      // Preact holds the first text node: put the committed text back in it.
      ;(t.firstChild as Text).data = t.dataset.was ?? ''
      t.blur()
    }
  }

  let show = (t: HTMLElement, text: string) => {
    if (md) t.innerHTML = md(text)
    else t.textContent = text
  }

  let finish = (t: HTMLElement) => {
    if (!t.isContentEditable) return
    drop(dkey) // commit or revert, the draft is spent
    t.normalize() // typing can split the text node; preact holds the first
    t.removeAttribute('contenteditable')
    let row = t.closest<HTMLElement>('[draggable]')
    if (row) row.draggable = true
    mode?.('normal')
    let was = t.dataset.was ?? ''
    let text = (t.textContent ?? '').trim()
    let shown = was
    if (!readOnly && text && text != was) {
      // What was typed shows at once; a refusal puts the stored value back.
      let wrote = write(eid, comp, prop, text)
      if (wrote) {
        shown = text
        wrote.then((ok) => ok || t.isContentEditable || show(t, was))
      }
    }
    show(t, shown)
    onClose?.()
  }

  // A permission change ends an existing edit too; the same finish path
  // restores its committed value without writing or leaving a draft behind.
  useLayoutEffect(() => {
    if (readOnly && ref.current) finish(ref.current)
  }, [readOnly])

  return h(Span, {
    elRef: ref,
    onDblClick: (ev: MouseEvent) => begin(ev.currentTarget as HTMLElement),
    onKeyDown: key,
    onInput: (ev: InputEvent) =>
      save(dkey, (ev.currentTarget as HTMLElement).textContent ?? ''),
    onBlur: (ev: FocusEvent) => finish(ev.currentTarget as HTMLElement),
    ...rendered,
  }, md ? null : value)
}
