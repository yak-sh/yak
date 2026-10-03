import { type Bundle, type Plugin, Refused, Stale } from '@yaks/graph'
import { after, each } from '@yaks/fp'
import { and, every, map, or, parse, present } from '@yaks/query'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { compile, type Lens, type Speaks } from './compile.ts'
import { docs } from './vocab.ts'
import type { Tx } from '@yaks/graph'

// The effectful shell supplies facts to the compiled, pure whole-change lens.
// The transaction repeats translation against current facts. Comparing its
// complete output guards relation membership as well as individual values:
// a concurrent acknowledgement cannot escape an explicit clear.
let facts = (
  lens: Lens,
  rows: Bundle[],
  tx: Tx,
): Bundle[] | Promise<Bundle[]> => {
  let queries = [
    ...new Set(
      lens.views.flatMap((v) =>
        Object.values(v.props).flatMap((p) =>
          'ack' in p
            ? [
              `.${p.ack.component}&?${
                p.ack.order.split('.')[0]
              }&?${p.ack.mark}&*`,
            ]
            : []
        )
      ),
    ),
  ]
  return after(
    each(
      queries,
      [] as Bundle[],
      (out, q) => after(tx.read(q), (more) => [...out, ...more]),
    ),
    (related) => {
      let refs = lens.views.flatMap((v) =>
        Object.values(v.props).flatMap((p) =>
          'ack' in p
            ? related.flatMap((r) => {
              let eid =
                (r[p.ack.component] as Record<string, unknown> | undefined)
                  ?.[p.ack.ref]
              return typeof eid == 'string' ? [eid] : []
            })
            : []
        )
      )
      return after(
        tx.get([...new Set([...rows.map((r) => r.entity.eid), ...refs])]),
        (
          held,
        ) => [
          ...new Map([...related, ...held].map((r) => [r.entity.eid, r]))
            .values(),
        ],
      )
    },
  )
}
type Check = {
  rows: Bundle[]
  speaks?: Speaks
  translated: Bundle[]
  now: number
  canonical?: boolean
}
let checked = '$lensCheck'
// A transaction may gather the same facts in a different component order.
// Identity pointers describe storage; the write's identity is its eid.
let change = (rows: Bundle[]) =>
  rows.map((row) => ({ ...row, entity: { eid: row.entity.eid } }))
let canonical = (value: unknown): string | undefined =>
  JSON.stringify(
    value,
    (_key, item) =>
      item && typeof item == 'object' && !Array.isArray(item)
        ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
        : item,
  )
let same = (a: Bundle[], b: Bundle[]) =>
  canonical(change(a)) == canonical(change(b))
export let lenses = (
  report: (error: unknown) => void = (error) => console.error(error),
  pending?: { vocab: Vocab; rows: Bundle[] },
): Plugin => {
  let expansion = pending ? compile(pending.rows) : undefined
  if (expansion && !expansion.views.some((v) => pending!.vocab.comp(v.from))) {
    expansion = undefined
  }
  let current = (
    rows: Bundle[],
    tx: Tx,
  ): Bundle[] | Promise<Bundle[]> => {
    if (!expansion) return rows
    let lens = expansion
    return after(facts(lens, rows, tx), (held) =>
      after(
        each(
          lens.views.filter((v) => pending!.vocab.comp(v.from)),
          held,
          (out, v) =>
            after(
              tx.read(`.${v.from}&?created&?updated&*`),
              (source) => [...out, ...source],
            ),
        ),
        (all) => {
          let at = new Map(all.map((r) => [r.entity.eid, r]))
          for (let row of rows) {
            let was = at.get(row.entity.eid)
            let merged = { ...was, ...row } as Bundle
            for (let [c, p] of Object.entries(row)) {
              if (
                c != 'entity' && !c.startsWith('$') && p &&
                typeof p == 'object'
              ) merged[c] = { ...was?.[c] as object, ...p }
            }
            at.set(row.entity.eid, merged)
          }
          let sources = [...at.values()].filter((r) =>
            lens.views.some((v) => !!r[v.from])
          )
          let moved = lens.put(sources, {
            facts: [...at.values()],
            migrate: true,
          })
          for (let row of moved) {
            let was = at.get(row.entity.eid)
            let merged = { ...was, ...row } as Bundle
            for (let [c, p] of Object.entries(row)) {
              if (
                c != 'entity' && !c.startsWith('$') && p && typeof p == 'object'
              ) merged[c] = { ...was?.[c] as object, ...p }
            }
            for (let v of lens.views) delete merged[v.from]
            delete merged.$was
            at.set(row.entity.eid, merged)
          }
          return rows.map((r) => {
            let held = at.get(r.entity.eid)!
            let out = { ...r }
            for (let v of lens.views) {
              for (let p of Object.values(v.props)) {
                let c = 'path' in p
                  ? p.path.split('.')[0]
                  : 'ack' in p
                  ? p.ack.mark
                  : undefined
                if (!c) continue
                let asked = !!r[v.from] || c in r ||
                  'ack' in p && p.ack.component in r
                if (asked && held[c] !== undefined) out[c] = held[c]
              }
              delete out[v.from]
            }
            return out
          })
        },
      ))
  }
  let forwardView = (
    { tx, vocab }: import('@yaks/graph').ReadContext,
    original: import('@yaks/query').Query,
  ): import('@yaks/graph').ReadView | null => {
    if (!expansion || !vocab) return null
    let canonical = [
      ...new Set(
        expansion.views.flatMap((v) =>
          Object.values(v.props).flatMap((p) =>
            'path' in p
              ? [p.path.split('.')[0]]
              : 'ack' in p
              ? [p.ack.mark]
              : []
          )
        ),
      ),
    ]
    if (
      !canonical.some((c) =>
        JSON.stringify(original).includes(`"${c}"`) ||
        JSON.stringify(original).includes(`"${c}.`)
      )
    ) return null
    return {
      original,
      query: and(
        or(
          map(
            original,
            (c) =>
              c.kind == 'pred' &&
                  expansion!.views.some((v) =>
                    Object.values(v.props).some((p) =>
                      'ack' in p && c.path[0] == p.ack.mark
                    )
                  ) ||
                [
                  'fields',
                  'every',
                  'count',
                  'distinct',
                  'tally',
                  'order',
                  'limit',
                  'after',
                ].includes(c.kind)
                ? and()
                : c,
          ),
          ...expansion.views.filter((v) => vocab.comp(v.from)).map((v) =>
            present(v.from)
          ),
        ),
        every(),
      ),
      vocab,
      dependencies: [...expansion.dependencies, ...expansion.sources],
      expand: (rows: Bundle[]) => current(rows, tx),
      answer: (rows: Bundle[]) => rows,
    }
  }
  return ({
    name: 'lens',
    admission: () => true,
    reads: (opts) => !!opts.speaks || !!expansion,
    vocab: docs,
    requests: ['$speaks', checked, '$lensKeep'],
    hooks: {
      normalize: (rows, tx, _error, context) => {
        if (rows.some((r) => r[checked] || r.$lensKeep)) {
          throw new Refused('reserved lens transaction check')
        }
        if (!expansion && !rows.some((r) => r.$speaks !== undefined)) {
          return rows
        }
        let vocab = (context?.graph as { vocab?: Vocab } | undefined)?.vocab
        let translate = () =>
          after(
            tx.read('._lens'),
            (steps) =>
              each(rows, [] as Bundle[], (out, row) => {
                if (row.$speaks === undefined && !expansion) {
                  return [...out, row]
                }
                let speaks = row.$speaks as Speaks
                if (
                  speaks !== undefined &&
                  (!speaks || typeof speaks != 'object' ||
                    Array.isArray(speaks))
                ) throw new Error('Lens: $speaks must be a package version map')
                let { $speaks: _, ...bundle } = row
                let spoken = speaks === undefined
                  ? undefined
                  : compile(steps, speaks)
                let canonical = !spoken || !spoken.views.length && !!expansion
                let lens = canonical && expansion
                  ? expansion
                  : spoken ?? compile(steps)
                if (!lens.views.length) {
                  return [...out, ...lens.put([bundle as Bundle])]
                }
                return after(facts(lens, [bundle as Bundle], tx), (held) => {
                  let now = Date.now()
                  let translated = lens.put([bundle as Bundle], {
                    facts: held,
                    vocab,
                    now,
                    canonical,
                  })
                  if (!lens.views.length) {
                    return [...out, ...translated]
                  }
                  let check: Check = {
                    rows: [bundle as Bundle],
                    speaks,
                    translated,
                    now,
                    canonical,
                  }
                  return [
                    ...out,
                    ...translated.map((b, i) =>
                      i ? b : { ...b, [checked]: check }
                    ),
                  ]
                })
              }),
          )
        let refuse = (error: unknown): never => {
          report(error)
          throw error instanceof Stale ? error : new Refused(
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
      precondition: (rows, tx, _error, context) => {
        let checks = rows.flatMap((r) =>
          r[checked] ? [r[checked] as Check] : []
        )
        if (!checks.length) return rows
        let vocab = (context?.graph as { vocab?: Vocab } | undefined)?.vocab
        return after(
          tx.read('._lens'),
          (steps) =>
            after(
              each(checks, undefined, (_, check) => {
                let lens = check.canonical && expansion
                  ? expansion
                  : compile(steps, check.speaks)
                return after(facts(lens, check.rows, tx), (held) => {
                  let out = lens.put(check.rows, {
                    facts: held,
                    vocab,
                    now: check.now,
                    canonical: check.canonical,
                  })
                  if (!same(out, check.translated)) {
                    throw new Refused(
                      'Lens: referenced facts changed before the write',
                    )
                  }
                  return undefined
                })
              }),
              () =>
                rows.map((r) => {
                  let { [checked]: _, $lensKeep: historic, ...out } = r
                  if (historic) {
                    let keep = historic as {
                      component: string
                      value: Bundle[string]
                    }
                    out[keep.component] = keep.value
                  }
                  return out as Bundle
                }),
            ),
        )
      },
    },
    ask: ({ opts, tx }, query) =>
      opts.speaks
        ? after(
          tx.read('._lens'),
          (rows) => compile(rows, opts.speaks).ask(query),
        )
        : query,
    view: ({ opts, tx, vocab }, original) => {
      if (!opts.speaks) return forwardView({ opts, tx, vocab }, original)
      return after(tx.read('._lens'), (steps) => {
        let lens = compile(steps, opts.speaks)
        if (!lens.views.length) {
          return forwardView({ opts, tx, vocab }, original)
        }
        let mentions = (v: Lens['views'][number]) =>
          JSON.stringify(original).includes(`\"${v.from}\"`) ||
          JSON.stringify(original).includes(`\"${v.from}.`)
        if (!lens.views.some(mentions)) return null
        if (!vocab) throw new Error('Lens: a graph view needs its vocabulary')
        return {
          original,
          // Exact old filters, windowing and aggregates run after inversion.
          // A view can also match absence and joins, so all canonical candidates
          // remain eligible; current callers never take this path.
          query: (() => {
            let mandatory = lens.views.filter((v) =>
              original.clauses.some((c) =>
                c.kind == 'pred' && c.path[0] == v.from && c.op != '?' &&
                !(c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == '')
              )
            )
            return mandatory.length
              ? and(
                ...mandatory.map((v) =>
                  vocab.comp(v.from)
                    ? or(parse(v.match), present(v.from))
                    : parse(v.match)
                ),
                every(),
              )
              : and(every())
          })(),
          vocab: loadVocab(lens.schema(vocab.docs)),
          dependencies: [...lens.dependencies, ...lens.sources],
          saved: true,
          answer: (rows: Bundle[]) =>
            after(
              facts(lens, rows, tx),
              (held) => lens.get(rows, { facts: held, vocab, now: opts.now }),
            ),
        }
      })
    },
    answer: ({ opts, tx, vocab }, rows) => {
      if (!opts.speaks) return current(rows, tx)
      return after(tx.read('._lens'), (steps) => {
        let lens = compile(steps, opts.speaks)
        if (!lens.views.length) {
          return after(
            current(rows, tx),
            (expanded) =>
              opts.patch
                ? after(
                  facts(lens, expanded, tx),
                  (held) => lens.get(expanded, { facts: held, patch: true }),
                )
                : lens.get(expanded),
          )
        }
        return after(
          facts(lens, rows, tx),
          (held) =>
            lens.get(rows, {
              facts: held,
              vocab,
              now: opts.now,
              patch: opts.patch,
            }),
        )
      })
    },
  })
}
