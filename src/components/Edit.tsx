import { useEffect, useRef } from 'preact/hooks'
import { ent, mode, mutate } from '../live.ts'
import { drop, peek, save } from './drafts.ts'
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
// Keystrokes save a draft; blur spends it — so a hot swap mid-edit
// remounts, finds the draft, and resumes editing where typing stopped.
export let Edit = (
  { eid, comp, prop, multi, open, onClose }: {
    eid: string
    comp: string
    prop: string
    multi?: boolean
    open?: boolean
    onClose?: () => void
  },
) => {
  let comps = ent(eid) as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >
  let value = String(comps[comp]?.[prop] ?? '')
  let ref = useRef<HTMLElement>(null)
  let dkey = `${eid}.${comp}.${prop}`

  let begin = (t: HTMLElement) => {
    let row = t.closest<HTMLElement>('[draggable="true"]')
    if (row) row.draggable = false
    t.dataset.was = t.textContent ?? ''
    t.contentEditable = 'plaintext-only'
    t.focus()
    getSelection()?.setPosition(t, t.childNodes.length) // caret at the end
    mode.value = 'insert'
  }

  useEffect(() => {
    let t = ref.current
    if (!t || t.isContentEditable) return
    let d = peek(dkey) // a draft only exists mid-edit: resume it
    if (!open && !d) return
    begin(t) // records the COMMITTED value as `was` — Escape still reverts
    if (d) {
      t.textContent = d.v
      getSelection()?.setPosition(t, t.childNodes.length)
    }
  }, [open])

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
    if (text && text != was) mutate({ eid, name: comp, comp: { [prop]: text } })
    else if (t.firstChild instanceof Text) t.firstChild.data = was
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
    >
      {value}
    </Span>
  )
}
