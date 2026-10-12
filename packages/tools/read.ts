// Direct read invocation: the same tool boundary without recorded work.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { namedTool } from '@yaks/graph/call'
import type { Opts, Runner } from './runner.ts'
import { CallError } from './errors.ts'
import { invoke } from './invoke.ts'
import { results, toolEid } from './result.ts'

/** A read-only runner refuses recorded work before it invokes a tool. */
export let reader = (g: Graph, opts: Opts): Runner => {
  let tools = opts.tools.map(namedTool)
  let by = new Map(tools.map((t) => [toolEid(t.name), t]))
  let otherwise = opts.otherwise && namedTool(opts.otherwise)
  let now = opts.now ?? (() => performance.now())
  let { ending } = results(g.vocab, now)
  let refuse = (): Promise<never> =>
    Promise.reject(
      new CallError('read', 'a read-only runner cannot record work'),
    )
  return {
    tools,
    rules: [],
    read: async (call: Bundle) => {
      let tool = opts.takes && !opts.takes(call)
        ? undefined
        : by.get(String((call.call as Comp).to)) ?? otherwise
      if (!tool?.readOnly) {
        throw new CallError('read', 'a read needs a read-only tool')
      }
      let started = now()
      return await invoke(
        call,
        tool,
        g,
        opts,
        (made, state) => [...made, ...ending(call, started, state, made)],
      )
    },
    ensure: refuse,
    call: refuse,
    run: refuse,
    due: refuse,
    drive: refuse,
    interrupt: refuse,
    interruptCall: refuse,
  }
}
