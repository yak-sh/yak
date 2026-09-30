// A picker's options, asked of the GRAPH rather than scanned from what the
// page holds. A scan offers only what happens to be resident, so under a
// partial cache a picker silently narrows to the entities already loaded;
// the server answers over the whole graph. The host's `find` is the one
// server search; the hook here debounces it and aborts a stale request, so a
// late answer never repaints a newer query.
import { useEffect, useState } from 'preact/hooks'

/** A server search: the entities a line answers, at most `limit`. */
export type Find<T> = (
  line: string,
  limit: number,
  signal?: AbortSignal,
) => Promise<T[]>

/// pickLine('T-3') -> 'T-3 *'
/// pickLine('') -> '.doc *'
/// pickLine('ali', 'person') -> 'ali .person *'
/// pickLine('', 'person') -> '.person *'
/**
 * A picker's query line: its standing component filter ANDed with what's
 * typed. `comp` is the component every candidate must wear ('' = any doc); an
 * empty line still lists recent candidates by the presence filter. A doc
 * picker passes '' rather than 'doc' on purpose: with no component filter a
 * typed line stays a SINGLE text predicate, so the server's id addressing
 * still resolves a typed human id (T-3); full-text search returns only
 * documented entities anyway.
 *
 * The typed text leads and the presence filter trails ('ali .person', never
 * '.person ali'): an &-segment that STARTS with a dot-param reads as one
 * token, so a term after it would land inside the value; a leading term puts
 * a ' .' in the segment, the boundary that splits it into a text predicate
 * plus the presence one. An empty line is the bare filter, which parses
 * alone.
 *
 * `*` asks for each candidate whole: a presence filter alone answers only the
 * component it names, and a candidate is labelled by its title.
 */
export let pickLine = (q: string, comp = ''): string => {
  q = q.trim()
  let filter = comp ? `.${comp}` : q ? '' : '.doc'
  return [q, filter, '*'].filter(Boolean).join(' ')
}

/** A live picker's hits, asked of `find`: refetched as the line settles
 * (150ms), the last request aborted so a slow answer can't overwrite a newer
 * one. An empty line clears the list without a round trip. The answer is an
 * answer to a query, not a component's own state, so it is held here. */
export let useHits = <T>(line: string, limit: number, find: Find<T>): T[] => {
  let [found, setFound] = useState<T[]>([])
  useEffect(() => {
    if (!line) {
      setFound([])
      return
    }
    let abort = new AbortController()
    let timer = setTimeout(
      () => find(line, limit, abort.signal).then(setFound).catch(() => {}),
      150,
    )
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [line, limit])
  return found
}
