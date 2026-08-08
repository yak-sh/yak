import { useEffect, useRef, useState } from 'preact/hooks'
import { type Hit, idOf, kindOrder, plural, uuid } from '../types.ts'
import { ent, mutate, searchOpen } from '../live.ts'
import { menuAt, navigate } from './nav.tsx'
import { drop, peek, save } from './drafts.ts'
import { block } from './ui.tsx'
import { Icon } from './icons.tsx'
import { useComplete } from './Complete.tsx'
import { title } from './title.tsx'

// `/` in normal mode opens the palette (the App shell owns the hotkey
// and the mount, so any root can search; the `open` callback decides
// what a pick does); Escape closes it. Search runs server-side (FTS5
// over every doc) — the palette is just an input, a ranked list, and
// j/k-ish keys. searchOpen lives in the shell (live.ts) so a hot swap
// can't shut the palette; the query itself is a draft, reseeded on
// remount.
export { searchOpen }

let Frame = block('div', 'Search', {
  Box: 'div',
  Line: 'div',
  Board: 'button',
  Head: 'div',
  Hit: 'a',
  Title: 'span',
  Id: 'span',
  Snip: 'div',
})
let { Box, Line, Board, Head, Hit: Row, Title, Id, Snip } = Frame

// The palette is a NAVIGATOR — you open a board or project, not read mail —
// so hits group by kind: navigational kinds lead, bulky content kinds
// (mail, comment) sink to the tail under their own headers. A kind named in
// neither list falls between, ordered by kindOrder so grouping is stable.
let lead = ['project', 'board', 'task', 'design', 'memory', 'canvas']
let tail = ['mail', 'comment']
let rank = (kind: string) => {
  let i = lead.indexOf(kind)
  if (i >= 0) return i
  let j = tail.indexOf(kind)
  return j >= 0 ? 900 + j : 100 + kindOrder.indexOf(kind)
}
// Stable sort by section rank keeps each kind's hits in the order db.ts
// ranked them; the flattened result is what the selection walks.
let group = (hits: Hit[]) =>
  [...hits].sort((a, b) => rank(a.kind) - rank(b.kind))

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
  let [q, setQ] = useState('')
  let [drag, setDrag] = useState(false)
  let box = useRef<HTMLInputElement>(null)
  let seq = useRef(0)
  let c = useComplete() // the dot-grammar's dropdown, under the input

  useEffect(() => {
    if (!searchOpen.value || !box.current) return
    let d = peek('search') // a swap remounted us mid-search: pick it back up
    if (d?.v && !box.current.value) {
      box.current.value = d.v
      setQ(d.v)
    }
    box.current.focus()
  }, [searchOpen.value])

  // FTS shares the server's one event loop with keypress delivery. Search
  // only after the line settles: a request per letter queues stale work ahead
  // of the word the typist is still entering. Cleanup also keeps a late answer
  // from repainting a closed or newer palette.
  useEffect(() => {
    if (!searchOpen.value) return
    if (!q.trim()) {
      setHits([])
      setErr('')
      return
    }
    let abort = new AbortController()
    let timer = setTimeout(() => seek(q, abort.signal), 150)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [q, searchOpen.value])
  if (!searchOpen.value) return null

  // The kind-grouped list, flattened: the selection index and every key
  // walk THIS order, so arrowing crosses sections in the order they paint.
  let ordered = group(hits)

  let close = () => {
    seq.current++
    searchOpen.value = false
    drop('search')
    setHits([])
    setSel(0)
    setQ('')
    setDrag(false)
  }
  let seek = async (q: string, signal: AbortSignal) => {
    let mine = ++seq.current
    let found: Hit[] = []
    let bad = ''
    try {
      let r = await fetch(`/search?q=${encodeURIComponent(q)}`, { signal })
      if (r.ok) found = await r.json()
      else bad = await r.text() // a malformed filter, said where you typed
    } catch (e) {
      if (signal.aborted) return
      throw e
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
  let href = (h: Hit) => `/${idOf(h.open_eid == h.eid ? h : ent(h.open_eid))}`
  // The board chip's click: the search BECOMES a board — the line is
  // already a query (terms are text preds, query.ts), so the board saves
  // it verbatim and stays live. Named by the line; retitle it in place.
  let board = () => {
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
      // ⌘/Ctrl+Enter is cmd-click on the selected hit: a new tab, the
      // palette left standing — same as cmd-clicking the row anchor.
      if (e.metaKey || e.ctrlKey) {
        if (ordered[sel]) globalThis.open?.(href(ordered[sel]))
        return
      }
      if (ordered[sel]) pick(ordered[sel])
      return
    }
    let down = e.key == 'ArrowDown' || (e.ctrlKey && e.key == 'n') ||
      (e.ctrlKey && e.key == 'j')
    let up = e.key == 'ArrowUp' || (e.ctrlKey && e.key == 'p') ||
      (e.ctrlKey && e.key == 'k')
    if (!down && !up) return
    e.preventDefault()
    setSel((s) =>
      Math.min(Math.max(s + (down ? 1 : -1), 0), ordered.length - 1)
    )
  }

  return (
    <Frame
      mod={drag && 'drag'}
      onMouseDown={(e: MouseEvent) => e.target == e.currentTarget && close()}
      // The veil owns its pointers — a press here must not fall through
      // to the shell beneath (Menu does the same).
      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
    >
      <Box>
        <Line>
          <Icon name='search' />
          <input
            ref={box}
            placeholder='search the graph… (* = prefix, .status=done .updated.at=today filter, ⌘⏎ = new tab)'
            onInput={(e: InputEvent) => {
              let el = e.currentTarget as HTMLInputElement
              el.value ? save('search', el.value) : drop('search')
              setQ(el.value)
              c.track(el)
            }}
            onKeyDown={key}
          />
          {
            /* The board chip: the line is a live query, and this is its
              handle. Click saves it as a board and opens it; dragging it
              onto the canvas drops the SPEC — a text/plain paste payload
              the canvas already knows how to mint (paste.ts json()). While
              the chip flies, the veil goes pointer-transparent so the drop
              hit-tests through to the canvas beneath; a landed drop closes
              the palette, a cancelled one restores it. */
          }
          {!!q.trim() && (
            <Board
              type='button'
              draggable
              data-tip='save as board — or drag onto the canvas'
              onClick={board}
              onDragStart={(ev: DragEvent) => {
                ev.dataTransfer?.setData(
                  'text/plain',
                  JSON.stringify({
                    doc: { title: q.trim(), body: '' },
                    board: { query: q.trim() },
                  }),
                )
                setDrag(true)
              }}
              onDragEnd={(ev: DragEvent) => {
                if (ev.dataTransfer?.dropEffect != 'none') close()
                else setDrag(false)
              }}
            >
              <Icon name='kanban' />
            </Board>
          )}
          {c.list}
        </Line>
        {err && <Snip>{err}</Snip>}
        {
          /* Each hit is a real anchor: cmd/middle-click opens a new tab,
            right-click opens the target entity's menu, and a plain click
            keeps the palette's own open — a card spawned on the canvas. */
        }
        {ordered.flatMap((h, i) => {
          // A header opens each kind's run; the tail kinds (mail, comment)
          // wear a divider so the navigational targets read as the top.
          let head = !i || ordered[i - 1].kind != h.kind
          let row = (
            <Row
              key={h.eid}
              href={href(h)}
              mod={i == sel ? 'sel' : undefined}
              onMouseEnter={() => setSel(i)}
              onContextMenu={menuAt(ent(h.open_eid))}
              onClick={(e: MouseEvent) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button != 0) {
                  return
                }
                e.preventDefault()
                pick(h)
              }}
            >
              <Title {...title(h.title || '(untitled)')} />
              <Id>{idOf(h)}</Id>
              <Snip>{marked(h.snip)}{h.retired && ' · retired'}</Snip>
            </Row>
          )
          if (!head) return [row]
          return [
            <Head
              key={`head-${h.kind}`}
              mod={tail.includes(h.kind) && 'demoted'}
            >
              {plural(h.kind)}
            </Head>,
            row,
          ]
        })}
      </Box>
    </Frame>
  )
}
