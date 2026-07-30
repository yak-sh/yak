// The vocabulary at the caret: wire any query input to complete() in
// query.ts and get a dropdown of the grammar's own candidates — comps,
// props, ops, enum values, wells. The hook owns token detection (the
// dot-token under the caret), selection, and acceptance (splice the
// token, re-fire input so the host reacts); the host input keeps its own
// handlers — call key() FIRST in onKeyDown and stop when it returns true
// (the dropdown consumed the press), track() from onInput. Wells are
// read here, at the browser boundary, so complete() itself stays pure.
import { useRef, useState } from 'preact/hooks'
import { type Cand, complete } from '../query.ts'
import { domains } from '../live.ts'
import { block } from './ui.tsx'
import { Overlay } from './overlay.tsx'

let Frame = block('div', 'Complete', { Row: 'div', Text: 'span', Kind: 'span' })
let { Row, Text, Kind } = Frame

let CAP = 8

// the dot-token from its start to the caret — back past anything that
// isn't a separator; a token not starting with '.' is nobody's business
let tokenAt = (value: string, caret: number) => {
  let start = caret
  while (start > 0 && !/[\s&]/.test(value[start - 1])) start--
  let tok = value.slice(start, caret)
  return tok.startsWith('.') ? { start, tok } : null
}

type Box = HTMLInputElement | HTMLTextAreaElement

export let useComplete = () => {
  let [cands, setCands] = useState<Cand[]>([])
  let [sel, setSel] = useState(0)
  let at = useRef({ el: null as Box | null, start: 0, end: 0 })
  let anchor = useRef<Box | null>(null)

  let close = () => {
    setCands([])
    setSel(0)
  }
  let track = (el: Box) => {
    anchor.current = el
    let caret = el.selectionStart ?? el.value.length
    let hit = tokenAt(el.value, caret)
    if (!hit) return close()
    at.current = { el, start: hit.start, end: caret }
    let list = complete(hit.tok, { domains: domains.value }).slice(0, CAP)
    setCands(list)
    setSel(0)
  }
  let accept = (c: Cand) => {
    let { el, start, end } = at.current
    if (!el) return
    el.value = el.value.slice(0, start) + c.text + el.value.slice(end)
    let caret = start + c.text.length
    el.setSelectionRange(caret, caret)
    el.focus()
    // the host's own onInput does the rest — seek, chips, and re-track,
    // so accepting '.status=' rolls straight into its values
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  let key = (e: KeyboardEvent): boolean => {
    if (!cands.length) return false
    if (e.key == 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return true
    }
    if (e.key == 'ArrowDown' || e.key == 'ArrowUp') {
      e.preventDefault()
      let d = e.key == 'ArrowDown' ? 1 : -1
      setSel((s) => Math.min(Math.max(s + d, 0), cands.length - 1))
      return true
    }
    if (e.key == 'Tab' || (e.key == 'Enter' && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault()
      accept(cands[sel])
      return true
    }
    return false
  }
  let list = cands.length == 0 ? null : (
    <Overlay anchor={anchor} side='below'>
      <Frame>
        {cands.map((c, i) => (
          <Row
            key={c.text}
            mod={i == sel ? 'sel' : undefined}
            onMouseEnter={() => setSel(i)}
            // mousedown, prevented: accept without ever blurring the input
            onMouseDown={(e: MouseEvent) => {
              e.preventDefault()
              accept(c)
            }}
          >
            <Text>{c.text}</Text>
            <Kind>{c.kind}</Kind>
          </Row>
        ))}
      </Frame>
    </Overlay>
  )
  return { track, key, close, list }
}
