// The on-demand door, exported as `@yaks/builders/tools`: `builder build`
// builds a builder now, whatever its floor says.
//
// It decides exactly as the schedule does (./build.ts `decide`), less the
// floor, and with the model and provider the caller names in place of the
// configured ones — which is how one builder gets a sibling output per model,
// to compare them. An unchanged key is not an error: the output already built
// is named and nothing runs.
//
// It writes the build itself, signed as whoever asked, and answers in one
// line, the way @yaks/spawn's `session spawn` does: the bundles a build writes
// are a session's first entry and an empty output, and a caller wants their
// ids, not their dump.

import { argsOf, type Bundle, type Comp, signed, who } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { CallError } from '@yaks/tools'
import { OUTPUT } from '@yaks/session'
import type { Vocab } from '@yaks/vocab'
import { BUILT, clock, decide, type Options } from './build.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

// A tool's text answer, as a row recording which call it came from.
let said = (call: Bundle, body: string): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  content: { body },
  [OUTPUT]: { source: call.entity.eid },
})

/** The implementation behind `builder_build`, built from the same
 * configuration as the effects. */
export let runs = (host: { vocab: Vocab }, options: Options = {}): Runs => ({
  builder_build: async (call, graph): Promise<Bundle[]> => {
    if (!options.desk) {
      throw new CallError(
        'unconfigured',
        'no desk is configured, so nothing builds on this graph',
      )
    }
    let args = argsOf(call)
    let builder = str(args.builder)
    let provider = str(args.provider)
    let model = str(args.model)
    let desk = {
      ...options.desk,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }
    let o = { desk, rest: options.rest, vocab: host.vocab }
    let v = await graph.storage.tx((tx) =>
      decide(o, builder, tx, clock(), false)
    )
    if (!v) {
      throw new CallError(
        'refused',
        `${str(args.builder)} is no builder with an instruction`,
      )
    }
    if (!v.build) {
      return [said(call, `${v.plan.output} is built under this key already`)]
    }
    await graph.apply(signed(v.build, who(call)))
    let made = v.build.find((b) => b[BUILT])?.[BUILT] as Comp
    return [said(call, `${v.plan.output} building in ${str(made.session)}`)]
  },
})
