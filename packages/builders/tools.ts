// The on-demand door reconciles a definition now. Alternate model settings
// make a shadow variant; the underlying work still goes through a tool call.

import {
  argsOf,
  type Bundle,
  type Comp,
  sha256,
  signed,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { CallError } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { clock, type Options, reconcile } from './build.ts'
import { type Desk, modelTool } from './model.ts'

let str = (v: unknown): string => v == null ? '' : String(v)
let said = (call: Bundle, body: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  content: { body },
  output: { source: call.entity.eid },
})

export let runs = (
  host: { vocab: Vocab },
  options: Omit<Options, 'vocab'> & { desk?: Desk } = {},
): Runs => ({
  builder_model: modelTool(options.desk).run,
  builder_build: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let builder = str(args.builder)
    let [definition] = await graph.get([builder])
    if (!definition?.builder) {
      throw new CallError('refused', `${builder} is no builder`)
    }
    if (definition.archived) {
      throw new CallError(
        'refused',
        `${human(host.vocab)(definition)} is archived`,
      )
    }
    let using = {
      ...(definition.using as Comp | undefined),
      ...args.provider ? { provider: args.provider } : {},
      ...args.model ? { model: args.model } : {},
    }
    let template = args.template == null
      ? (definition.content as Comp | undefined)?.body
      : args.template
    let alternate = args.provider != null || args.model != null ||
      args.template != null
    let variant = alternate
      ? `shadow:${sha256(JSON.stringify([using, template]))}`
      : 'main'
    let result = await graph.storage.tx((tx) =>
      reconcile(
        tx,
        definition,
        {
          ...options,
          vocab: host.vocab,
          variant,
          using,
          template: str(template),
        },
        clock(),
        false,
        true,
      )
    )
    if (result.writes.length) {
      await graph.apply(signed(result.writes, who(call)), { trusted: true })
    }
    return [said(
      call,
      result.plans.length
        ? result.plans.map((p) => p.build).join('\n')
        : `${builder} has no matching bindings`,
    )]
  },
})
