// The on-demand door, exported as `@yaks/builders/tools`: `builder build`
// builds a builder now, whatever its floor says.
//
// It decides exactly as the schedule does (./build.ts `decide`), less the
// floor. Alternate model, provider, or prompt settings get a shadow output
// beside the primary one. An unchanged key is not an error: the output already
// built is named and nothing runs.
//
// It writes the build itself, signed as whoever asked, and answers with the
// run and session ids. Named outputs arrive when that session answers.

import {
  argsOf,
  type Bundle,
  type Comp,
  sha256,
  signed,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { CallError } from '@yaks/tools'
import { OUTPUT } from '@yaks/session'
import type { Vocab } from '@yaks/vocab'
import { BUILD, clock, decide, type Options } from './build.ts'

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
    let prompt = str(args.prompt)
    let desk = {
      ...options.desk,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }
    let alternate = (provider && provider != options.desk.provider) ||
      (model && model != options.desk.model) || prompt
    let shadow = alternate
      ? `shadow:${sha256(JSON.stringify([desk.provider, desk.model, prompt]))}`
      : undefined
    let o = {
      desk,
      rest: options.rest,
      vocab: host.vocab,
      shadow,
      prompt,
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
    }
    let v = await graph.storage.tx((tx) =>
      decide(o, builder, tx, clock(), false, 'explicit')
    )
    if (!v) {
      throw new CallError(
        'refused',
        `${str(args.builder)} is no builder with an instruction`,
      )
    }
    if (!v.build) {
      return [said(call, `${v.plan.run} is built under this key already`)]
    }
    await graph.apply(signed(v.build, who(call)), { trusted: true })
    let made = v.build.find((b) => b[BUILD])?.[BUILD] as Comp
    return [said(call, `${v.plan.run} building in ${str(made.session)}`)]
  },
})
