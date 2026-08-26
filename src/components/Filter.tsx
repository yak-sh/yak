// The ephemeral filter — typed in the titlebar, felt in the face. It ANDs
// into the view's own query only while it's typed, never stored:
// board.query is the saved filter, this is the glance. Same grammar as
// everywhere (query.ts), same completion dropdown as the palette; a line
// that doesn't parse yet filters nothing — inert, because a bar
// mid-keystroke is no place to throw. Escape clears; blurring empty
// leaves nothing. The input (FilterInput, rendered by the card chrome)
// and the rows it screens (passOf, read by the face) live in different
// subtrees, so a module-held signal per TARGET is the wire between them
// — keyed by the viewed entity, switching tabs (Board ⇄ List) keeps the
// glance.
import { useEffect, useRef } from 'preact/hooks'
import { type Signal, signal } from '@preact/signals'
import { sieve } from '../live.ts'
import { useDraft } from './drafts.ts'
import { block } from './ui.tsx'
import { useComplete } from './Complete.tsx'

let Frame = block('div', 'Filter', {})

let lines = new Map<string, Signal<string>>()
let lineOf = (eid: string, initial = '') => {
  let s = lines.get(eid)
  if (!s) lines.set(eid, s = signal(initial))
  return s
}

// the faces that listen — the titlebar consults this to decide whether
// the current view earns the input or just the spacer
export let filterable = new Set(['Board', 'List'])

// the bar's current text, for a face that must know whether it is SCREENING
// at all: a count the server computed over the saved query is the truth only
// while nothing narrows it here. Reading the signal subscribes the caller.
export let filterLine = (eid: string): string => lineOf(eid).value

// the face's half: the current pass predicate for this entity's rows
export let passOf = (eid: string, initial = ''): (eid: string) => boolean => {
  try {
    return sieve(lineOf(eid, initial).value)
  } catch {
    return () => true // half a token yet — show everything
  }
}

// the titlebar's half: the input + its completion dropdown. Uncontrolled
// so the draft can reseed the caret without a controlled re-render
// clobbering it; the line SIGNAL stays the wire to passOf, mirrored on
// every keystroke. A draft keyed by the viewed entity survives a hot
// swap (which mints a fresh lines Map) or reload; absent a draft, a live
// glance from this session — the signal outlives a card remount, the DOM
// input doesn't — is reflected back on mount.
export let FilterInput = (
  { eid, initial = '' }: { eid: string; initial?: string },
) => {
  let c = useComplete()
  let line = lineOf(eid, initial)
  let box = useRef<HTMLInputElement>(null)
  let { sync, spend } = useDraft(`filter:${eid}`, box, (v) => line.value = v)
  useEffect(() => {
    if (box.current && !box.current.value && line.value) {
      box.current.value = line.value
    }
  }, [])
  return (
    <Frame>
      <input
        ref={box}
        defaultValue={line.value}
        placeholder='filter…'
        onInput={(e: InputEvent) => {
          let el = e.currentTarget as HTMLInputElement
          sync(el) // saves the draft and mirrors into the line signal
          c.track(el)
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (c.key(e)) return
          if (e.key == 'Escape') {
            let el = e.currentTarget as HTMLInputElement
            if (el.value) e.stopPropagation() // consumed by the clear
            el.value = ''
            line.value = ''
            spend()
            el.blur()
          }
        }}
        onBlur={() => c.close()}
      />
      {c.list}
    </Frame>
  )
}
