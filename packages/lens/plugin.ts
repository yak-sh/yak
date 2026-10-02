import { type Bundle, type Plugin, Refused } from '@yaks/graph'
import { after } from '@yaks/fp'
import { compile, type Speaks } from './compile.ts'
import { docs } from './vocab.ts'

/** Rename at the generic graph boundaries. A current caller carries no
 * version, so it takes the existing path without reading rows or parsing.
 * Synchronous storage stays synchronous, including Durable Object writes. */
export let lenses = (
  report: (error: unknown) => void = (error) => console.error(error),
): Plugin => ({
  name: 'lens',
  reads: (opts) => !!opts.speaks,
  vocab: docs,
  requests: ['$speaks'],
  hooks: {
    normalize: (rows, tx) => {
      if (!rows.some((r) => r.$speaks !== undefined)) return rows
      let translate = () =>
        after(tx.read('._lens'), (steps) =>
          rows.map((row) => {
            if (row.$speaks === undefined) return row
            let speaks = row.$speaks as Speaks
            if (!speaks || typeof speaks != 'object' || Array.isArray(speaks)) {
              throw new Error('Lens: $speaks must be a package version map')
            }
            let { $speaks: _, ...bundle } = row
            return compile(steps, speaks).put(bundle as Bundle)
          }))
      let refuse = (error: unknown): never => {
        report(error)
        throw new Refused(
          error instanceof Error ? error.message : String(error),
        )
      }
      try {
        let out = translate()
        return out instanceof Promise ? out.catch(refuse) : out
      } catch (error) {
        return refuse(error)
      }
    },
  },
  ask: ({ opts, tx }, query) =>
    opts.speaks
      ? after(
        tx.read('._lens'),
        (rows) => compile(rows, opts.speaks).ask(query),
      )
      : query,
  answer: ({ opts, tx }, rows) => {
    if (!opts.speaks) return rows
    return after(tx.read('._lens'), (steps) => {
      let lens = compile(steps, opts.speaks)
      let view = (at?: Map<string, Bundle>) => {
        let out = rows.map((row) => lens.get(row, at?.get(row.entity.eid)))
        return out.every((r, i) => r === rows[i]) ? rows : out
      }
      return opts.patch
        ? after(
          tx.get(rows.map((r) => r.entity.eid)),
          (held) => view(new Map(held.map((r) => [r.entity.eid, r]))),
        )
        : view()
    })
  },
})
