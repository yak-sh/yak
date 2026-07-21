// The ephemeral filter — a slim line atop a board or list that ANDs into
// the view's own query only while it's typed. Never stored: board.query
// is the saved filter, this is the glance. Same grammar as everywhere
// (query.ts), same completion dropdown as the palette; a line that
// doesn't parse yet filters nothing — inert, because a bar mid-keystroke
// is no place to throw. Escape clears; blurring empty leaves nothing.
import { useState } from 'preact/hooks'
import { sieve } from '../live.ts'
import { block } from './ui.tsx'
import { useComplete } from './Complete.tsx'

let Frame = block('div', 'Filter', {})

export let useFilter = () => {
  let [line, setLine] = useState('')
  let c = useComplete()
  let pass: (eid: string) => boolean
  try {
    pass = sieve(line)
  } catch {
    pass = () => true // half a token yet — show everything
  }
  let bar = (
    <Frame>
      <input
        placeholder='filter…'
        onInput={(e: InputEvent) => {
          let el = e.currentTarget as HTMLInputElement
          setLine(el.value)
          c.track(el)
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (c.key(e)) return
          if (e.key == 'Escape') {
            let el = e.currentTarget as HTMLInputElement
            if (el.value) e.stopPropagation() // consumed by the clear
            el.value = ''
            setLine('')
            el.blur()
          }
        }}
        onBlur={() => c.close()}
      />
      {c.list}
    </Frame>
  )
  return { pass, bar }
}
