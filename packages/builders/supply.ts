// Supply one binding's slot through the same plan and output keys as a tool
// answer. The call, its zero-dollar answer and its outputs land together, so
// neither the tool runner nor reconciliation has work to do for this key.

import {
  type Actor,
  type Bundle,
  type Comp,
  type Graph,
  signed,
} from '@yaks/graph'
import { CallError } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { outputs } from './answer.ts'
import {
  buildFor,
  ids,
  type Options,
  outputFor,
  reconcile,
  start,
  subject,
} from './build.ts'

/** One existing artifact for one binding's slot. `for` names the first entity
 * of its outer tuple; ambiguous bindings are refused rather than guessed.
 * `args` keeps provenance beside the frozen binding, without changing its key. */
export type Supply = {
  builder: string
  for: string
  slot: string
  artifact: string
  args?: Comp
}

export let supply = async (
  graph: Graph,
  vocab: Vocab,
  ask: Supply,
  actor: Actor | null,
  options: Omit<Options, 'vocab'> = {},
): Promise<string> => {
  let names = await graph.address([ask.builder, ask.for, ask.artifact])
  let eid = (id: string) => names.get(id) ?? id
  let builder = eid(ask.builder)
  let target = eid(ask.for)
  let artifact = eid(ask.artifact)
  if (!ask.slot) throw new CallError('refused', 'supply needs a slot')
  let [definition, blob] = await graph.get([builder, artifact])
  if (!definition?.builder) {
    throw new CallError('refused', `${ask.builder} is no builder`)
  }
  if (definition.archived) {
    throw new CallError('refused', `${ask.builder} is archived`)
  }
  if (!blob?.artifact) {
    throw new CallError('refused', `${ask.artifact} is no artifact`)
  }
  let plan = await graph.storage.tx(async (tx) => {
    let result = await reconcile(
      tx,
      definition,
      {
        ...options,
        vocab,
        only: [target],
        variant: 'main',
      },
      undefined,
      false,
    )
    let matches = result.plans.filter((p) => subject(p.binding) == target)
    if (matches.length != 1) {
      throw new CallError(
        'refused',
        `${ask.for} has ${matches.length} bindings of ${ask.builder}; ` +
          'supply needs exactly one',
      )
    }
    let p = matches[0]
    if (p.build.startsWith('$')) p.build = crypto.randomUUID()
    let [before] = await tx.get([p.build])
    let writes = start(p, before?.build as Comp | undefined, options.eid)
    let [run, call] = writes
    call.call = {
      ...call.call as Comp,
      args: {
        ...ask.args,
        ...(call.call as Comp).args as Comp,
        supplied: true,
      },
    }
    call.execution = { state: 'done' }
    call.cost = { dollars: 0, reported: true }
    let value = {
      outputs: [{
        slot: ask.slot,
        inputs: ids(p.binding),
        components: {},
        artifact,
      }],
      cost: 0,
    }
    writes.push({
      entity: { eid: crypto.randomUUID() },
      result: { call: call.entity.eid, ms: 0 },
    }, {
      entity: { eid: crypto.randomUUID() },
      output: { source: call.entity.eid, value },
    }, ...await outputs(tx, run, call, value, vocab, false))
    // Reconciliation also refreshed the immediate builder's dependencies.
    writes.push(
      ...result.writes.filter((row) => row.builder_dep || row.$delete),
    )
    return { p, writes }
  })
  await graph.apply(signed(plan.writes, actor), { trusted: true })
  let build = await buildFor(graph, builder, plan.p.binding.entities)
  let output = build && await outputFor(graph, build, ask.slot)
  if (!output) throw new Error('supplied output has no output_of owner')
  return output
}
