// The browser's door to server search — the FTS5 `/search` seam Search.tsx
// opened, factored out so every entity picker asks the GRAPH for its options
// instead of scanning the loaded cache. A cache scan offers only what happens
// to be resident, so under a partial cache a picker silently narrows to the
// entities already loaded; the server answers over the whole graph. One raw
// fetch and a debounced hook over it; both abort a stale request so a late
// answer never repaints a newer query.
import { useEffect, useState } from 'preact/hooks'
import { base } from '../live.ts'
import type { Hit } from '../types.ts'

// One server search. A malformed filter answers 400 — the typist's news in
// the palette, but a picker has no error slot, so a bad line simply yields no
// options (the same "no matches yet" a half-typed filter always showed). An
// abort is silent: the caller replaced the query and no longer wants this one.
export let hits = async (
  q: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Hit[]> => {
  let r = await fetch(
    `${base()}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { signal },
  )
  return r.ok ? (await r.json()) as Hit[] : []
}

// A picker's query line: its standing component filter ANDed with what's
// typed. `comp` is the component every candidate must wear ('' = any doc); an
// empty line still lists recent candidates via the presence filter. A doc
// picker passes '' rather than 'doc' on purpose: with no component filter a
// typed line stays a SINGLE text pred, so the server's id-addressing (findEid)
// still resolves a typed human id (T-3) — FTS already returns only documented
// entities, so the doc filter would be redundant AND would disable that path.
//
// The typed text leads and the presence filter trails ('ali .person!', never
// '.person! ali'): parseQuery reads an &-segment that STARTS with a dot-param
// as one token, so a term after it lands inside the value and '.person!' with
// a trailing value is a parse error — a leading term instead puts a ' .' in
// the segment, the boundary that makes it split into a text pred plus the
// presence pred (query.ts). An empty line is the bare filter, which parses alone.
export let pickLine = (q: string, comp = '') => {
  q = q.trim()
  return comp ? [q, `.${comp}!`].filter(Boolean).join(' ') : q || '.doc!'
}

// A live picker's hits: refetch as the line settles (150ms, the palette's own
// debounce), aborting the last request so a slow answer can't overwrite a
// newer one. An empty line clears the list without a round trip.
export let useHits = (line: string, limit = 8): Hit[] => {
  let [found, setFound] = useState<Hit[]>([])
  useEffect(() => {
    if (!line) {
      setFound([])
      return
    }
    let abort = new AbortController()
    let timer = setTimeout(
      () => hits(line, limit, abort.signal).then(setFound).catch(() => {}),
      150,
    )
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [line, limit])
  return found
}
