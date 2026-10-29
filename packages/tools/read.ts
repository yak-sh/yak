// Direct read invocation: the same tool boundary without recorded work.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { namedTool } from '@yaks/graph/call'
import type { Opts, Runner } from './runner.ts'
import { CallError } from './errors.ts'
import { invoke } from './invoke.ts'
import { measuring, results } from './result.ts'
import { registryOf } from './registry.ts'

/** A read-only runner refuses recorded work before it invokes a tool. */
export let reader = (g: Graph, opts: Opts): Runner => {
  let catalog = registryOf(opts.tools)
  let otherwise = opts.otherwise && namedTool(opts.otherwise)
  let clock = opts.clock ?? measuring
  let now = () => clock.now()
  let { ending } = results(g.vocab, now)
  let refuse = (): Promise<never> =>
    Promise.reject(
      new CallError('read', 'a read-only runner cannot record work'),
    )
  let toolOf = (call: Bundle) =>
    opts.takes && !opts.takes(call)
      ? undefined
      : catalog.get(String((call.call as Comp).to)) ?? otherwise
  let read = async (call: Bundle, tool = toolOf(call)) => {
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
  }
  return {
    registry: catalog,
    admit: (asked) => {
      let tool = toolOf(asked)
      return tool &&
        { tool, ensure: refuse, call: refuse, read: () => read(asked, tool) }
    },
    get tools() {
      return catalog.list()
    },
    rules: [],
    read,
    ensure: refuse,
    call: refuse,
    run: refuse,
    due: refuse,
    drive: refuse,
    interrupt: refuse,
    interruptCall: refuse,
  }
}
