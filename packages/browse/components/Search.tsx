import { entityPath, searchPath } from '../url.ts'
import { useEffect, useRef, useState } from 'preact/hooks'
import { type Hit, idOf, kindOrder, plural } from '../types.ts'
import { ent, searchOpen } from '../live.ts'
import { follow } from './nav.tsx'
import { block } from '@yaks/ui'
import { Icon } from './icons.tsx'
import { fields } from './fields.tsx'
import { Entity } from './Entity.tsx'
import { hits as queryHits } from './hits.ts'

// `/` in normal mode opens the palette (the App shell owns the hotkey
// and the mount, so any root can search; the `open` callback decides
// what a pick does); Escape closes it. Search runs server-side (FTS5
// over every doc) — the palette is just an input, a ranked list, and
// j/k-ish keys. searchOpen lives in the shell (live.ts) so a hot swap
// can't shut the palette; the query itself is the `search` field
// (fields.tsx), whose text is the person's draft until the palette closes.
export { searchOpen }

let Frame = block('div', 'Search', {
  Box: 'div',
  Line: 'div',
  Page: 'a',
  Head: 'div',
  Hit: 'div',
  Snip: 'span',
})
let { Box, Line, Page, Head, Hit: Row, Snip } = Frame

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
let exact = (h: Hit, q: string) => {
  let sought = q.trim().replace(/^"(.*)"$/s, '$1').toLowerCase()
  return idOf(h).toLowerCase() == sought ||
    h.title.trim().toLowerCase() == sought
}

// An exact address or title stays first; section grouping must not bury the
// thing the operator named. Every other hit keeps the db's rank within its
// kind, and the flattened result is what the selection walks.
export let group = (hits: Hit[], q: string) =>
  [...hits].sort((a, b) =>
    Number(exact(b, q)) - Number(exact(a, q)) || rank(a.kind) - rank(b.kind)
  )

// Matches arrive marked \x01…\x02 — rendered as <mark> WITHOUT parsing
// any HTML out of the data.
let marked = (s: string) =>
  s.split('\x01').flatMap((chunk, i) => {
    if (!i) return [chunk]
    let [hit, rest] = chunk.split('\x02')
    return [<mark key={i}>{hit}</mark>, rest]
  })

// The palette's field: its line is the person's draft, so it opens on what
// was being searched for, here or in another interface, until it closes.
let FIELD = 'search'

export let hitSlots = (h: Hit) => ({
  title: marked(h.title_hit || h.title || '(untitled)'),
  body: <Snip>{marked(h.snip)}{h.retired && ' · retired'}</Snip>,
})

export let Search = ({ open }: { open: (eid: string) => void }) => {
  let [hits, setHits] = useState<Hit[]>([])
  let [err, setErr] = useState('')
  let [sel, setSel] = useState(0)
  let q = fields.text(FIELD)
  let [drag, setDrag] = useState(false)
  let box = useRef<HTMLInputElement>(null)
  let seq = useRef(0)

  useEffect(() => {
    if (searchOpen.value) box.current?.focus()
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
  let ordered = group(hits, q)

  let close = () => {
    seq.current++
    searchOpen.value = false
    setHits([])
    setSel(0)
    fields.set(FIELD, '')
    setDrag(false)
  }
  let seek = async (q: string, signal: AbortSignal) => {
    let mine = ++seq.current
    let found: Hit[] = []
    let bad = ''
    try {
      found = await queryHits(q, 20, signal)
    } catch (e) {
      if (signal.aborted) return
      bad = e instanceof Error ? e.message : String(e)
    }
    if (mine != seq.current) return // a newer keystroke owns the list
    setHits(found)
    setErr(bad)
    setSel(0)
  }
  let pick = (h: Hit) => {
    open(h.open)
    close()
  }
  let href = (h: Hit) => entityPath(idOf(h.open == h.eid ? h : ent(h.open)))
  // The field's list took its keys (Escape included) before these.
  let key = (e: KeyboardEvent) => {
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
          <fields.Filter
            id={FIELD}
            mod='bare'
            elRef={box}
            placeholder='search the graph… (* = prefix, .task.status=done .updated.at=today filter, ⌘⏎ = new tab)'
            onKey={key}
          />
          {!!q.trim() && (
            <Page
              href={searchPath(q)}
              draggable
              aria-label='Open search as page'
              data-tip='open search as page — or drag its link'
              onClick={(ev: MouseEvent) => {
                follow(searchPath(q))(ev)
                if (ev.defaultPrevented) close()
              }}
              onDragStart={(ev: DragEvent) => {
                let url = new URL(searchPath(q), location.href).href
                ev.dataTransfer?.setData('text/uri-list', url)
                ev.dataTransfer?.setData('text/plain', url)
                setDrag(true)
              }}
              onDragEnd={() => setDrag(false)}
            >
              <Icon name='arrow-up-right' />
            </Page>
          )}
        </Line>
        {err && <Snip>{err}</Snip>}
        {
          /* Each registry tile is its own real entity anchor. The result shell
          intercepts only a plain click, whose search contract is to replace
          the root; modifier clicks and the tile's entity menu stay native. */
        }
        {ordered.flatMap((h, i) => {
          // A header opens each kind's run; the tail kinds (mail, comment)
          // wear a divider so the navigational targets read as the top.
          let head = !i || ordered[i - 1].kind != h.kind
          let row = (
            <Row
              key={h.eid}
              mod={i == sel ? 'sel' : undefined}
              onMouseEnter={() => setSel(i)}
              onClickCapture={(e: MouseEvent) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button != 0) {
                  return
                }
                e.preventDefault()
                e.stopPropagation()
                pick(h)
              }}
            >
              <Entity eid={h.open} view='Tile' slots={hitSlots(h)} />
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

// Addressed query results are the inspector's table/aggregate view.
export { InspectPage as SearchPage } from './inspect.tsx'
