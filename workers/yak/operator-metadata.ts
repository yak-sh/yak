import { Annotated } from '@yaks/ui/parts'
import type { Bundle, Comp } from '@yaks/graph/bundle'
import { type ComponentChildren as Node, h } from 'preact'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** One entry's position since compaction and its producing model request. */
export type Metadata = { seq: number; cost?: number; detail: string }

/** Admin metadata from recorded entries, requests and compaction positions. */
export let metadata = (
  entries: Bundle[],
  checkpoints: Bundle[],
  asks: Bundle[],
  models: Bundle[],
): Record<string, Metadata> => {
  let requests = new Map(
    asks.filter((b) => b.ask).map((b) => [b.entity.eid, b]),
  )
  let names = new Map(
    models.map((b) => [b.entity.eid, comp(b, 'model')?.name]),
  )
  return Object.fromEntries(
    entries.filter((b) => b.entry).map((b) => {
      let entry = comp(b, 'entry')!
      let seq = Number(entry.seq)
      let boundary = Math.max(
        0,
        ...checkpoints.filter((c) => {
          let at = comp(c, 'entry')!
          return at.session == entry.session && Number(at.seq) <= seq
        }).map((c) => Number(comp(c, 'entry')!.seq)),
      )
      let source = (comp(b, 'output') ?? comp(b, 'call'))?.source
      let ask = source ? requests.get(String(source)) : undefined
      let cost = comp(ask, 'cost')?.dollars
      let usage = comp(ask, 'usage')
      let model = comp(ask, 'using')?.model ?? comp(ask, 'ask')?.to
      let detail = [
        `Entry ${seq}; ${seq - boundary} since last compact`,
        ask && `Model: ${names.get(String(model)) ?? model ?? 'unknown'}`,
        ask &&
        (cost == null
          ? 'Request price not recorded'
          : `Request cost: $${cost}`),
        ask && 'Shared by entries produced by this model request',
        usage?.input_tokens != null && `Tokens in: ${usage.input_tokens}`,
        usage?.cached_tokens != null && `Cached: ${usage.cached_tokens}`,
        usage?.output_tokens != null && `Tokens out: ${usage.output_tokens}`,
      ].filter((s) => s !== false && s != null).join(' · ')
      return [b.entity.eid, {
        seq: seq - boundary,
        ...cost != null ? { cost: Number(cost) } : {},
        detail,
      }]
    }),
  )
}

let dollars = (cost: number) =>
  '$' + cost.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })

/** A quiet margin outside the message's reading column. */
export let measured = (node: Node, meta?: Metadata) =>
  !meta ? node : h(
    Annotated,
    {},
    h(Annotated.Content, {}, node),
    h(
      Annotated.Margin,
      { tabindex: 0, 'data-tip': meta.detail, 'aria-label': meta.detail },
      h(Annotated.Number, { 'data-sequence': '' }, `#${meta.seq}`),
      meta.cost != null
        ? h(Annotated.Number, { 'data-cost': '' }, dollars(meta.cost))
        : null,
    ),
  )
