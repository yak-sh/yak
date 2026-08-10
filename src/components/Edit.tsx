import { useEffect, useRef } from 'preact/hooks'
import { ent, mode, mutate, problem, want } from '../live.ts'
import { propAt } from '../props.ts'
import { drop, peek, save } from './drafts.ts'
import { markdown, markup } from './Markdown.tsx'
import { el } from './ui.tsx'

let Span = el('span', 'Edit')

// The generic in-place editor: <Edit eid comp prop /> renders the prop's
// current value; double-click turns the SAME node plaintext-editable — no
// swap, no layout shift, just the caret and seam the [contenteditable]
// styles add. Enter or blur commits the one changed column through the
// normal patch path; Escape (or an empty result) reverts. A draggable
// ancestor (a board row) pauses while editing so clicks place the cursor
// instead of starting a drag.
// multi: Enter inserts a newline instead of committing (blur commits).
// open: mount already editing — for hosts that swap rendered content for
// source (the markdown body), where there's no same-node dblclick to
// start from. onClose fires when the edit ends, commit or revert.
// inline: show inline markdown at rest, but edit and save its source.
// Keystrokes save a draft; blur spends it — so a hot swap mid-edit
// remounts, finds the draft, and resumes editing where typing stopped.
export let Edit = (
  { eid, comp, prop, multi, open, onClose, inline }: {
    eid: string
    comp: string
    prop: string
    multi?: boolean
    open?: boolean
    onClose?: () => void
    inline?: boolean
  },
) => {
  let comps = ent(eid) as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >
  let held = comps[comp]?.[prop]
  // A body may be DEFERRED (live.ts `want`): undefined is unloaded, not
  // empty. Seeding the editor from a value we don't have and committing on
  // blur would write a fragment over the stored body — so the editor stays
  // read-only until the body lands, and asking is what lands it.
  let unloaded = held === undefined && propAt(comp, prop)?.type == 'body'
  let value = String(held ?? '')
  let ref = useRef<HTMLElement>(null)
  let dkey = `${eid}.${comp}.${prop}`
  let rendered = inline ? markdown(value, undefined, true) : {}

  let begin = (t: HTMLElement) => {
    if (unloaded || t.isContentEditable) return
    let row = t.closest<HTMLElement>('[draggable="true"]')
    if (row) row.draggable = false
    t.dataset.was = value
    if (inline) t.textContent = value
    t.contentEditable = 'plaintext-only'
    t.focus()
    getSelection()?.setPosition(t, t.childNodes.length) // caret at the end
    mode.value = 'insert'
  }

  useEffect(() => {
    let t = ref.current
    if (unloaded) return void want(eid)
    if (!t || t.isContentEditable) return
    let d = peek(dkey) // a draft only exists mid-edit: resume it
    if (!open && !d) return
    begin(t) // records the COMMITTED value as `was` — Escape still reverts
    if (d) {
      t.textContent = d.v
      getSelection()?.setPosition(t, t.childNodes.length)
    }
    // `unloaded` is a dependency because the body LANDS: an editor opened
    // over a deferred body arms itself the moment its text arrives.
  }, [open, unloaded])

  let key = (ev: KeyboardEvent) => {
    let t = ev.currentTarget as HTMLElement
    if (!t.isContentEditable) return
    if (ev.key == 'Enter' && !multi) {
      ev.preventDefault()
      t.blur() // commit lives in blur — one path
    } else if (ev.key == 'Escape' && t.firstChild instanceof Text) {
      t.firstChild.data = t.dataset.was ?? '' // then the statusbar blurs us
    }
  }

  let blur = (ev: FocusEvent) => {
    let t = ev.currentTarget as HTMLElement
    if (!t.isContentEditable) return
    drop(dkey) // commit or revert, the draft is spent
    t.normalize() // typing can split the text node; preact holds the first
    t.contentEditable = 'false'
    let row = t.closest<HTMLElement>('[draggable]')
    if (row) row.draggable = true
    mode.value = 'normal'
    let was = t.dataset.was ?? ''
    let text = (t.textContent ?? '').trim()
    let shown = was
    if (text && text != was) {
      try {
        mutate({ eid, name: comp, comp: { [prop]: text } })
        shown = text
      } catch (e) {
        problem.value = e instanceof Error ? e.message : String(e)
      }
    }
    if (inline) t.innerHTML = markup(shown, undefined, true)
    else t.textContent = shown
    onClose?.()
  }

  return (
    <Span
      elRef={ref}
      onDblClick={(ev: MouseEvent) => begin(ev.currentTarget as HTMLElement)}
      onKeyDown={key}
      onInput={(ev: InputEvent) =>
        save(dkey, (ev.currentTarget as HTMLElement).textContent ?? '')}
      onBlur={blur}
      {...rendered}
    >
      {inline ? null : value}
    </Span>
  )
}
