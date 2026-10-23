/**
 * Code written for a storage, run in a view over what the view holds. A
 * function that reads a storage (`read` a query, `get` some entities), such as
 * a package's composer, is handed a {@link Reader} whose every read is one of
 * the view's asks: answered from what the host holds and kept live while the
 * view is mounted. A read not answered yet reads as nothing, so the function
 * returns what it could read; as each answer lands it runs again and reads on
 * from there, and when a write moves anything it read, it runs again with
 * that. The server's code and the page's agree because they are the same
 * code.
 *
 * A function that reads a storage asynchronously is still handed answers
 * synchronously here: it must stay synchronous over synchronous input, as
 * @yaks/fp's `after` and `each` do.
 *
 * @module
 */

import { useLayoutEffect, useState } from 'preact/hooks'
import { stringify } from '@yaks/query'
import type { Query } from '@yaks/graph'
import type { Bundle, Io } from './host.ts'

/** A storage that only reads: what code written for one needs of it. */
export type Reader = {
  read: (query: Query) => Bundle[]
  get: (eids: string[]) => Bundle[]
}

/** What a reading came to: the function's value over what was answered, and
 * whether every read it made was answered. */
export type Reading<T> = { value: T; ready: boolean }

/** The line `get` asks for some entities, each whole. */
/// whole(['a', 'b']) -> '.entity.eid=a,b&*'
export let whole = (eids: string[]): string => `.entity.eid=${eids.join(',')}&*`

/**
 * Run `read` over a reader whose reads are this view's asks: a hook, for a
 * view drawn by `io`.
 *
 * ```ts ignore
 * let { value, ready } = useReading(io, (r) => wear(r, io.vocab)(eid))
 * ```
 */
export let useReading = <T>(
  io: Io,
  read: (reader: Reader) => T,
): Reading<T> => {
  let [asked, ask] = useState<string[]>([])
  let got = io.ask(Object.fromEntries(asked.map((line) => [line, line])))
  let reads = new Set<string>()
  let ready = true
  let answer = (line: string): Bundle[] => {
    reads.add(line)
    let a = got[line]
    if (!a?.ready || a.error) ready = false
    return a?.rows ?? []
  }
  let value = read({
    read: (query) => answer(stringify(query)),
    get: (eids) => eids.length ? answer(whole(eids)) : [],
  })
  let now = [...reads].sort()
  let key = now.join('\n')
  let held = asked.join('\n')
  // What it read that the view does not hold yet is asked for, and what it
  // no longer reads let go; the answers run it again.
  useLayoutEffect(() => {
    if (key != held) ask(now)
  }, [key, held])
  return { value, ready: ready && key == held }
}
