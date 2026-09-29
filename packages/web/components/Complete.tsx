// The vocabulary at the caret: wire any query input to @yaks/query's
// complete() and get a dropdown of the grammar's own candidates — comps,
// props, ops, enum values, wells. The hook owns selection and acceptance
// (splice the word, re-fire input so the host reacts); the host input keeps
// its own handlers — call key() FIRST in onKeyDown and stop when it returns
// true (the dropdown consumed the press), track() from onInput. Wells and the
// resident entities (for `{eid}` params) are the source read here, at the
// browser boundary, so complete() itself stays pure. Resident-only, like
// wells: a picker that must reach non-loaded entities asks the server
// (suggest.ts).
import { useMemo, useRef, useState } from 'preact/hooks'
import { type Cand, complete, type Source } from '@yaks/query'
import { cache, domains } from '../live.ts'
import { idOf, kindOf, vocab } from '../types.ts'
import { propAt } from '../props.ts'
import { RANKS } from '../query.ts'
import { block } from '@yaks/ui'
import { Overlay } from './overlay.tsx'

let Frame = block('div', 'Complete', { Row: 'div', Text: 'span', Kind: 'span' })
let { Row, Text, Kind } = Frame

let CAP = 8

let starts = (s: string, pre: string) =>
  s.toLowerCase().startsWith(pre.toLowerCase())

type Box = HTMLInputElement | HTMLTextAreaElement

export let useComplete = () => {
  let [cands, setCands] = useState<Cand[]>([])
  let [sel, setSel] = useState(0)
  let at = useRef({ el: null as Box | null, start: 0, end: 0 })
  let anchor = useRef<Box | null>(null)

  // The resident graph as reference candidates, rebuilt only when the cache
  // turns over (not per keystroke) — one human id + kind per loaded entity.
  let ents = useMemo(
    () =>
      Object.entries(cache.value).map(([eid, comps]) => ({
        id: idOf({ eid, kind: kindOf(comps), num: comps.entity?.num }),
        kind: kindOf(comps),
      })),
    [cache.value],
  )
  // Wells are read when asked, never at render: a well the server has not
  // answered yet fills in by the next keystroke.
  let wells: Record<string, () => string[]> = { domains: () => domains.value }
  let source: Source<Cand[]> = {
    ids: (ref, pre) =>
      ents.filter((e) =>
        (ref == 'entity' || e.kind == ref) && starts(e.id, pre)
      )
        .map((e) => ({ text: e.id, kind: e.kind })),
    values: (comp, prop, pre) => {
      let t = propAt(comp, prop)?.type
      let well = t && typeof t == 'object' && 'text' in t ? t.text : ''
      return (wells[well]?.() ?? []).filter((v) => starts(v, pre))
        .map((text) => ({ text, kind: well }))
    },
    ranks: RANKS,
  }

  let close = () => {
    setCands([])
    setSel(0)
  }
  let track = (el: Box) => {
    anchor.current = el
    let caret = el.selectionStart ?? el.value.length
    let found = complete(vocab, el.value, caret, source)
    if (!found.cands.length) return close()
    at.current = { el, start: found.from, end: found.to }
    setCands(found.cands.slice(0, CAP))
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
