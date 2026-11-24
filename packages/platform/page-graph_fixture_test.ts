import type { Bundle } from '@yaks/graph'
import type { Client, Watch } from '@yaks/client'

// A page graph standing in for the tab's: each line's rows, set by the test,
// and each write answered as `answer` says.
export let graph = (answer: (b: Bundle[]) => Promise<Bundle[]>) => {
  let rows = new Map<string, Bundle[]>()
  let heard = new Map<string, Set<(b: Bundle[]) => void>>()
  let watch = (line: string) =>
    ({
      get value() {
        return rows.get(line) ?? []
      },
      ready: true,
      subscribe: (fn: (b: Bundle[]) => void) => {
        let all = heard.get(line) ?? new Set()
        heard.set(line, all.add(fn))
        return () => all.delete(fn)
      },
      close: () => {},
    }) as unknown as Watch
  let wrote: Bundle[][] = []
  return {
    wrote,
    set: (line: string, next: Bundle[]) => {
      rows.set(line, next)
      for (let fn of heard.get(line) ?? []) fn(next)
    },
    watch,
    mutate: (b: Bundle[]) => (wrote.push(b), answer(b)),
  } as unknown as Pick<Client, 'watch' | 'mutate'> & {
    wrote: Bundle[][]
    set: (line: string, rows: Bundle[]) => void
  }
}
