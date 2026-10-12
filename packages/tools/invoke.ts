// A tool's validation, caller identity, answer and fault, independent of persistence.
import type { Bundle, Comp, Graph, NamedTool } from '@yaks/graph'
import { who } from '@yaks/graph/call'
import { signed } from '@yaks/graph/provenance'
import { status } from '@yaks/graph/errors'
import type { Opts } from './runner.ts'
import { CallError, parsed, resolved, validated } from './args.ts'
import { Interrupted } from './errors.ts'
import { actionable, exceptionOf } from './fault.ts'
import { MOST } from './result.ts'

export type Land = (
  made: Bundle[],
  state: string,
  keeps?: boolean,
  code?: string,
) => Bundle[] | Promise<Bundle[]>
// An answer too long to send whole is refused, and so never reaches a door
// that would build its JSON in one string. It is measured one bundle at a
// time, stopping once past `most`, so measuring any answer costs at most that.
let measured = (answer: Bundle[], most: number) => {
  let size = 0
  for (let b of answer) {
    size += JSON.stringify(b).length
    if (size > most) {
      throw new CallError(
        'too_large',
        `the answer is ${answer.length} entities, past the ${most} ` +
          'characters of JSON a call answers in: ask for fewer',
      )
    }
  }
}

/** Invoke once, letting the owner retain the answer or return it in memory. */
export let invoke = async (
  call: Bundle,
  tool: NamedTool,
  g: Graph,
  opts: Pick<Opts, 'host' | 'process' | 'report' | 'most'>,
  land: Land,
): Promise<Bundle[]> => {
  let id = call.entity.eid
  let host = opts.host ?? g
  let c = call.call as Comp
  // What a thrown error becomes: the fault as its own entity, recording
  // which call it came from. An expected refusal gets `refusal{code}`: a
  // `CallError` with its code, or an error the graph's `status` puts below
  // 500 (a `Refused` write, an `Unknown` name) with its name. Anything else
  // is a defect, reported with its original thrown value.
  let faulted = async (error: unknown): Promise<Bundle[]> => {
    if (error instanceof Interrupted) {
      return [{
        entity: { eid: '$fault' },
        content: { body: String(error) },
        output: { source: id },
        ...(g.vocab.comp('notice') ? { notice: {} } : {}),
      }]
    }
    let code = error instanceof CallError
      ? error.code
      : status(error) < 500
      ? (error as Error).name
      : undefined
    if (
      code == undefined &&
      actionable(String(exceptionOf(error).value))
    ) {
      await opts.report?.(error, call, tool.name)
    }
    return [{
      entity: { eid: '$fault' },
      content: { body: String(error) },
      output: { source: id },
      ...code == undefined
        ? { exception: exceptionOf(error) }
        : { refusal: { code } },
    }]
  }
  let answered: Bundle[]
  try {
    let args = await resolved(tool, validated(tool, parsed(c.args)), host)
    let actor = who(call)
    let asking: Bundle = {
      ...call,
      call: { ...c, args },
      ...!call.created && actor ? { created: { ...actor } } : {},
      ...opts.process ? { process: opts.process } : {},
    }
    let made = await tool.run(asking, host)
    if (!tool.applied) made = signed(made, actor)
    measured(made, opts.most ?? MOST)
    // A rehearsal: `check: true` to a tool that writes runs the write's
    // every phase and rolls it back, so the answer is the batch as a kept
    // write would have returned it, or the refusal it would have met.
    if (!tool.readOnly && !tool.applied && args.check === true) {
      answered = await land(
        await g.apply(made, { check: true }),
        'done',
        false,
      )
    } else {
      answered = await land(made, 'done')
    }
  } catch (error) {
    // This catches both the tool's own throw and a rejection of what it
    // returned: a transaction the graph refuses is this call's failure,
    // rather than a call left claimed with nothing recorded about it.
    let made = await faulted(error)
    answered = await land(
      made,
      error instanceof Interrupted ? 'interrupted' : 'failed',
      undefined,
      error instanceof Interrupted ? error.code : undefined,
    )
  }
  return answered
}
