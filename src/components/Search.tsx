import { signal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { type Hit, idOf } from '../types.ts'
import { block } from './ui.tsx'

// `/` in normal mode opens the palette (Canvas owns the hotkey and the
// spawn); Escape closes it. Search runs server-side (FTS5 over every
// doc) — the palette is just an input, a ranked list, and j/k-ish keys.
export let searchOpen = signal(false)

let Frame = block('div', 'Search', {
  Box: 'div',
  Hit: 'div',
  Title: 'span',
  Id: 'span',
  Snip: 'div',
})
let { Box, Hit: Row, Title, Id, Snip } = Frame

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
  let [sel, setSel] = useState(0)
  let box = useRef<HTMLInputElement>(null)
  let seq = useRef(0)

  useEffect(() => {
    if (searchOpen.value) box.current?.focus()
  }, [searchOpen.value])
  if (!searchOpen.value) return null

  let close = () => {
    searchOpen.value = false
    setHits([])
    setSel(0)
  }
  let seek = async (q: string) => {
    let mine = ++seq.current
    let found: Hit[] = q.trim()
      ? await fetch(`/search?q=${encodeURIComponent(q)}`).then((r) => r.json())
      : []
    if (mine != seq.current) return // a newer keystroke owns the list
    setHits(found)
    setSel(0)
  }
  let pick = (h: Hit) => {
    open(h.open_eid)
    close()
  }
  let key = (e: KeyboardEvent) => {
    if (e.key == 'Escape') return close()
    if (e.key == 'Enter') {
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
    >
      <Box>
        <input
          ref={box}
          placeholder='search the graph… (* = prefix)'
          onInput={(e: InputEvent) =>
            seek((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={key}
        />
        {hits.map((h, i) => (
          <Row
            key={h.eid}
            mod={i == sel ? 'sel' : undefined}
            onMouseEnter={() => setSel(i)}
            onClick={() => pick(h)}
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
