import { pagePath } from '../hosting.ts'
import { entityPath, searchPath } from '../url.ts'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { type Hit, idOf, kindOrder, plural } from '../types.ts'
import { searchOpen } from '../live.ts'
import { follow, navigate } from './nav.tsx'
import { Loading, Palette as Frame } from '@yaks/ui'
import { Icon } from './icons.tsx'
import { fields } from './fields.tsx'
import { Entity } from './Entity.tsx'
import { InspectPage } from './inspect.tsx'
import { aggregate, hits as queryHits } from './hits.ts'
import { parse, words } from '@yaks/query'

// `/` in normal mode opens the palette (the App shell owns the hotkey
// and the mount, so any root can search; the `open` callback decides
// what a pick does); Escape closes it. Search runs server-side (FTS5
// over every doc) — the palette is just an input, a ranked list, and
// j/k-ish keys. searchOpen lives in the shell (live.ts) so a hot swap
// can't shut the palette; the query itself is the `search` field
// (fields.tsx), whose text is the person's draft until the palette closes.
export { searchOpen }

let { Box, Line, Page, Head, Hit: Row, Message: Snip } = Frame

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

// The palette's query is the person's draft.
let FIELD = 'search'

// The words a line searches for, which each result marks where they match;
// none while the line does not parse.
let sought = (q: string): string[] => {
  try {
    return words(parse(q))
  } catch {
    return []
  }
}

export let Search = ({ open }: { open: (eid: string) => void }) => {
  let [hits, setHits] = useState<Hit[]>([])
  let [err, setErr] = useState('')
  let [answered, setAnswered] = useState<string | undefined>()
  let [sel, setSel] = useState(0)
  let q = fields.text(FIELD)
  // One array a line, so a row redraws when the words change, not each time
  // the selection moves.
  let marks = useMemo(() => sought(q), [q])
  let [drag, setDrag] = useState(false)
  let box = useRef<HTMLInputElement>(null)
  let seq = useRef(0)

  useLayoutEffect(() => {
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
    setHits([])
    setErr('')
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
  let waiting = !!q.trim() && answered != q
  let ordered = group(waiting ? [] : hits, q)

  let close = () => {
    seq.current++
    searchOpen.value = false
    setHits([])
    setAnswered(undefined)
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
    if (signal.aborted || mine != seq.current) return // a newer keystroke owns the list
    setHits(found)
    setAnswered(q)
    setErr(bad)
    setSel(0)
  }
  let pick = (h: Hit) => {
    open(h.eid)
    close()
  }
  let href = (h: Hit) => entityPath(idOf(h))
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
      else if (q.trim() && !waiting && !err) {
        navigate(searchPath(q))
        close()
      }
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
      <Box role='dialog' aria-label='Search' aria-modal='true'>
        <Line>
          <Icon name='search' />
          <fields.Filter
            id={FIELD}
            mod='bare'
            elRef={box}
            placeholder='Search the graph…'
            aria-label='Search the graph'
            onKey={key}
          />
          {!!q.trim() && (
            <Page
              href={searchPath(q)}
              draggable
              aria-label='Open query as table'
              data-tip='open query as table — or drag its link'
              onClick={(ev: MouseEvent) => {
                follow(searchPath(q))(ev)
                if (ev.defaultPrevented) close()
              }}
              onDragStart={(ev: DragEvent) => {
                let url = location.origin + pagePath(searchPath(q))
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
        {waiting
          ? <Loading>Searching…</Loading>
          : err
          ? <Snip>{err}</Snip>
          : !q.trim()
          ? (
            <Snip>
              Type words or a query · Escape closes · ⌘/Ctrl+Enter opens a new
              tab
            </Snip>
          )
          : answered == q && aggregate(q)
          ? <InspectPage query={q} />
          : answered == q && !ordered.length && <Snip>No results.</Snip>}
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
              <Entity eid={h.eid} view='Search.Tile' words={marks} />
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
