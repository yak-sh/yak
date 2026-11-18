// Explicit history purges may release pooled bytes, after every surviving
// graph and plugin copy has had a chance to name the content it still needs.
import type { Bundle, Graph, Plugin } from '@yaks/graph'
import { after, each } from '@yaks/fp'
import type { Body } from './props.ts'
import { address, type Blobs, decode } from './store.ts'

let strings = (value: unknown): string[] => {
  if (typeof value == 'string') return [value]
  if (!value || typeof value != 'object') return []
  return Object.values(value).flatMap(strings)
}

let candidates = (removed: Bundle[]): Map<string, Set<string>> => {
  let found = new Map<string, Set<string>>()
  let keep = (sha: string, text: string) => {
    let values = found.get(sha) ?? new Set<string>([sha])
    values.add(text)
    found.set(sha, values)
  }
  for (let text of strings(removed)) {
    keep(address(text), text)
    if (/^[a-f0-9]{64}$/.test(text)) keep(text, text)
  }
  return found
}

let present = (store: Blobs, removed: Bundle[]) =>
  each(
    [...candidates(removed)],
    new Map<string, Set<string>>(),
    (found, [sha, values]) =>
      after(store.get(sha), (bytes) => {
        if (bytes) {
          values.add(decode(bytes))
          found.set(sha, values)
        }
        return found
      }),
  )

let retained = (graph: Graph, values: string[]) =>
  after(
    graph.storage.retained!(values),
    (found) =>
      each(graph.plugins, new Set(found), (kept, plugin) =>
        after(plugin.retained?.(graph, values), (more) => {
          for (let value of more ?? []) {
            kept.add(value)
          }
          return kept
        })),
  )

/** Release only bytes whose last live, historical and trash reference was
 * removed by an explicit purge. A store without retained-value accounting or
 * byte deletion keeps its pool. */
export let purged =
  (store: Blobs, held: Body[]): NonNullable<Plugin['purged']> =>
  (graph, removed) => {
    if (!store.drop || !graph.storage.retained) return
    return after(present(store, removed), (found) => {
      if (!found.size) return
      let values = [...new Set([...found.values()].flatMap((set) => [...set]))]
      return after(retained(graph, values), (kept) => {
        let free = [...found].filter(([, values]) =>
          ![...values].some((value) => kept.has(value))
        ).map(([sha]) => sha)
        if (free.length) return store.drop!(free, held)
      })
    })
  }
