import { useEffect, useRef, useState } from 'preact/hooks'
import { type Hit, idOf, uuid } from '../types.ts'
import { ent, mutate, searchOpen } from '../live.ts'
import { navigate } from './nav.tsx'
import { drop, peek, save } from './drafts.ts'
import { block } from './ui.tsx'
import { Icon } from './icons.tsx'
import { useComplete } from './Complete.tsx'

// `/` in normal mode opens the palette (Canvas owns the hotkey and the
// spawn); Escape closes it. Search runs server-side (FTS5 over every
// doc) — the palette is just an input, a ranked list, and j/k-ish keys.
// searchOpen lives in the shell (live.ts) so a hot swap can't shut the
// palette; the query itself is a draft, reseeded on remount.
export { searchOpen }

let Frame = block('div', 'Search', {
  Box: 'div',
  Line: 'div',
  Hit: 'a',
  Title: 'span',
  Id: 'span',
  Snip: 'div',
})
let { Box, Line, Hit: Row, Title, Id, Snip } = Frame

// Matches arrive marked \x01…\x02 — rendered as <mark> WITHOUT parsing
// any HTML out of the data.
let marked = (s: string) =>
  s.split('\x01').flatMap((chunk, i) => {
    if (!i) return [chunk]
    let [hit, rest] = chunk.split('\x02')
    return [<mark key={i}>{hit}</mark>, rest]
  })

export let Search = ({ open }: { open: (eid: string) => void }) => {
  let [hits, setHits] = useState<Hit[]>([])
  let [err, setErr] = useState('')
  let [sel, setSel] = useState(0)
  let box = useRef<HTMLInputElement>(null)
  let seq = useRef(0)
  let c = useComplete() // the dot-grammar's dropdown, under the input

  useEffect(() => {
    if (!searchOpen.value || !box.current) return
    let d = peek('search') // a swap remounted us mid-search: pick it back up
    if (d?.v && !box.current.value) {
      box.current.value = d.v
      seek(d.v)
    }
    box.current.focus()
  }, [searchOpen.value])
  if (!searchOpen.value) return null

  let close = () => {
    searchOpen.value = false
    drop('search')
    setHits([])
    setSel(0)
  }
  let seek = async (q: string) => {
    let mine = ++seq.current
    let found: Hit[] = []
    let bad = ''
    if (q.trim()) {
      let r = await fetch(`/search?q=${encodeURIComponent(q)}`)
      if (r.ok) found = await r.json()
      else bad = await r.text() // a malformed filter, said where you typed
    }
    if (mine != seq.current) return // a newer keystroke owns the list
    setHits(found)
    setErr(bad)
    setSel(0)
  }
  let pick = (h: Hit) => {
    open(h.open_eid)
    close()
  }
  // ⌘/Ctrl+Enter: the search BECOMES a board — the line is already a
  // query (terms are text preds, query.ts), so the board saves it
  // verbatim and stays live. Named by the line; retitle it in place.
  let board = (q: string) => {
    if (!q.trim()) return
    let eid = uuid()
    mutate(
      { eid, name: 'doc', comp: { title: q.trim(), body: '' } },
      { eid, name: 'board', comp: { query: q.trim() } },
    )
    close()
    navigate(`/${eid}`)
  }
  let key = (e: KeyboardEvent) => {
    if (c.key(e)) return // the dropdown eats its keys (Escape included)
    if (e.key == 'Escape') return close()
    if (e.key == 'Enter') {
      if (e.metaKey || e.ctrlKey) {
        return board((e.currentTarget as HTMLInputElement).value)
      }
      if (hits[sel]) pick(hits[sel])
      return
    }
    let down = e.key == 'ArrowDown' || (e.ctrlKey && e.key == 'n') ||
      (e.ctrlKey && e.key == 'j')
    let up = e.key == 'ArrowUp' || (e.ctrlKey && e.key == 'p') ||
      (e.ctrlKey && e.key == 'k')
    if (!down && !up) return
    e.preventDefault()
    setSel((s) => Math.min(Math.max(s + (down ? 1 : -1), 0), hits.length - 1))
  }

  return (
    <Frame
      onMouseDown={(e: MouseEvent) => e.target == e.currentTarget && close()}
      // The canvas beneath pans on pointerdown WITH pointer capture —
      // a captured pointerup retargets to the canvas, so no click ever
      // reaches a hit. The veil owns its pointers (Menu does the same).
      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
    >
      <Box>
        <Line>
          <Icon name='search' />
          <input
            ref={box}
            placeholder='search the graph… (* = prefix, .status=done .modified_at=today filter, ⌘⏎ = board)'
            onInput={(e: InputEvent) => {
              let el = e.currentTarget as HTMLInputElement
              el.value ? save('search', el.value) : drop('search')
              seek(el.value)
              c.track(el)
            }}
            onKeyDown={key}
          />
          {c.list}
        </Line>
        {err && <Snip>{err}</Snip>}
        {
          /* Each hit is a real anchor: cmd/middle-click and the native
            menu do the new-tab forms; a plain click keeps the palette's
            own open — a card spawned on the canvas. */
        }
        {hits.map((h, i) => (
          <Row
            key={h.eid}
            href={`/${idOf(h.open_eid == h.eid ? h : ent(h.open_eid))}`}
            mod={i == sel ? 'sel' : undefined}
            onMouseEnter={() => setSel(i)}
            onClick={(e: MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button != 0) return
              e.preventDefault()
              pick(h)
            }}
          >
            <Title>{h.title || '(untitled)'}</Title>
            <Id>{idOf(h)}</Id>
            <Snip>{marked(h.snip)}</Snip>
          </Row>
        ))}
      </Box>
    </Frame>
  )
}
