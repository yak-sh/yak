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
import { type Signal, signal } from '@preact/signals'
import { sieve } from '../live.ts'
import { block } from './ui.tsx'
import { useComplete } from './Complete.tsx'

let Frame = block('div', 'Filter', {})

let lines = new Map<string, Signal<string>>()
let lineOf = (eid: string) => {
  let s = lines.get(eid)
  if (!s) lines.set(eid, s = signal(''))
  return s
}

// the faces that listen — the titlebar consults this to decide whether
// the current view earns the input or just the spacer
export let filterable = new Set(['Board', 'List'])

// the face's half: the current pass predicate for this entity's rows
export let passOf = (eid: string): (eid: string) => boolean => {
  try {
    return sieve(lineOf(eid).value)
  } catch {
    return () => true // half a token yet — show everything
  }
}

// the titlebar's half: the input + its completion dropdown
export let FilterInput = ({ eid }: { eid: string }) => {
  let c = useComplete()
  let line = lineOf(eid)
  return (
    <Frame>
      <input
        placeholder='filter…'
        value={line.value}
        onInput={(e: InputEvent) => {
          let el = e.currentTarget as HTMLInputElement
          line.value = el.value
          c.track(el)
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (c.key(e)) return
          if (e.key == 'Escape') {
            let el = e.currentTarget as HTMLInputElement
            if (el.value) e.stopPropagation() // consumed by the clear
            el.value = ''
            line.value = ''
            el.blur()
          }
        }}
        onBlur={() => c.close()}
      />
      {c.list}
    </Frame>
  )
}
