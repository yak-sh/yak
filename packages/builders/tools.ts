// The on-demand door reconciles a definition now, staged or not. Alternate
// model settings make a shadow variant; `only` and `limit` build some
// bindings and leave the rest as they are. The underlying work still goes
// through a tool call. `build` is that reconciliation for any host's door:
// the box's `builder build` tool below, and a yaks.app store's `/build`.

import {
  type Actor,
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  sha256,
  signed,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { CallError } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { held } from '@yaks/key'
import { BUILD_OF, buildOf, clock, type Options, reconcile } from './build.ts'
import { type Desk, modelTool } from './model.ts'
import { type Supply, supply } from './supply.ts'

let str = (v: unknown): string => v == null ? '' : String(v)
let said = (call: Bundle, body: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  content: { body },
  output: { source: call.entity.eid },
})

/** What `builder build` asks: the builder, and what to build it with. Ids may
 * be any form the graph resolves. */
export type Ask = {
  builder: string
  provider?: string
  model?: string
  template?: string
  only?: string[]
  limit?: number
}

/** Reconcile one builder now, writing as `actor`, and answer the builds it
 * planned. A builder that is missing or archived, or a name in `only` that no
 * binding holds, is refused. */
export let build = async (
  graph: Graph,
  vocab: Vocab,
  ask: Ask,
  actor: Actor | null,
  options: Omit<Options, 'vocab'> = {},
): Promise<string[]> => {
  let at = await graph.address([ask.builder, ...ask.only ?? []])
  let eid = (id: string) => at.get(id) ?? id
  let builder = eid(ask.builder)
  let [definition] = await graph.get([builder])
  if (!definition?.builder) {
    throw new CallError('refused', `${ask.builder} is no builder`)
  }
  if (definition.archived) {
    throw new CallError('refused', `${human(vocab)(definition)} is archived`)
  }
  let using = {
    ...(definition.using as Comp | undefined),
    ...ask.provider ? { provider: ask.provider } : {},
    ...ask.model ? { model: ask.model } : {},
  }
  let template = ask.template == null
    ? (definition.content as Comp | undefined)?.body
    : ask.template
  let alternate = ask.provider != null || ask.model != null ||
    ask.template != null
  let variant = alternate
    ? `shadow:${sha256(JSON.stringify([using, template]))}`
    : 'main'
  let only = ask.only?.map(eid)
  let limit = ask.limit
  let result = await graph.storage.tx((tx) =>
    reconcile(
      tx,
      definition,
      {
        ...options,
        vocab,
        variant,
        using,
        template: str(template),
        only,
        limit,
      },
      clock(),
      false,
      true,
    )
  )
  // A name no binding holds is a mistake to say, unless the limit cut the
  // run short before reaching it.
  let unbound = (only ?? []).filter((eid) =>
    !result.plans.some((p) => p.binding.entities.includes(eid))
  )
  if (unbound.length && (limit == null || result.plans.length < limit)) {
    let named = (await graph.get(unbound)).map(human(vocab))
    throw new CallError(
      'refused',
      `${named.join(', ')} ${named.length == 1 ? 'is' : 'are'} ` +
        `in no binding of ${human(vocab)(definition)}`,
    )
  }
  if (result.writes.length) {
    await graph.apply(signed(result.writes, actor), { trusted: true })
  }
  // A new build was written under an alias; its key names it now.
  let values = result.plans.map((p) => buildOf(p.builder, p.match, p.variant))
  let found = await held(graph, BUILD_OF, values)
  return values.map((v) => {
    let owner = found.get(v)
    if (!owner) throw new CallError('refused', `build_of key ${v} has no owner`)
    return owner
  })
}

export let runs = (
  host: { vocab: Vocab },
  options: Omit<Options, 'vocab'> & { desk?: Desk } = {},
): Runs => ({
  builder_model: modelTool(options.desk).run,
  builder_supply: async (call, graph): Promise<Bundle[]> => {
    let output = await supply(
      graph,
      host.vocab,
      argsOf(call) as Supply,
      who(call),
      options,
    )
    return [said(call, output)]
  },
  builder_build: async (call, graph): Promise<Bundle[]> => {
    let ask = argsOf(call) as Ask
    let builds = await build(graph, host.vocab, ask, who(call), options)
    return [said(
      call,
      builds.length
        ? builds.join('\n')
        : `${ask.builder} has no matching bindings`,
    )]
  },
})
