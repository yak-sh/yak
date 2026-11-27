// The object a call that outlasts its caller runs in (outlast.ts, index.ts
// `Outlast`): one per caller, tool and target. It runs the tool as the door
// would, as the person and through the credential the door verified, with
// the directory opened afresh as mcp.ts opens it.
import { CallError } from '@yaks/tools/errors'
import { Durable, type State } from '@yaks/durable-object/object'
import type { Clock } from '@yaks/fp'
import { running } from './agent.ts'
import { caught, toolTags } from './defects.ts'
import { copyOf } from './directory-copy.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { narrowed } from './grants.ts'
import { type Ended, type Heard, outlasting } from '@yaks/tools/outlast'
import { clock } from './timing.ts'
import type { Asked } from './outlast.ts'
import { PUBLISHED } from './published.ts'
import type { Ctx } from './tool.ts'
import { TOOLS } from './tools.ts'

let ran = async (
  env: Env,
  asked: Asked,
  doing: (step: string) => void,
): Promise<Ended> => {
  let named = (tool: { name: string }) => tool.name == asked.tool
  let t = TOOLS.find(named) ?? PUBLISHED.find(named)
  if (!t) return { refused: { code: 'missing', text: `no tool ${asked.tool}` } }
  let { space, spaceEid } = asked.who ?? {}
  let reopen = () => {
    let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    })
    return space || spaceEid ? narrowed(dir, space ?? undefined, spaceEid) : dir
  }
  let c = clock()
  let ctx: Ctx = {
    env,
    dir: reopen(),
    reopen,
    person: asked.person,
    doing,
    clock: c,
    ...asked.who ? { who: asked.who } : {},
  }
  try {
    let said = await c.counting(() => running(ctx, t)(asked.args, asked.call))
    return { said, timing: c.header('tool_') }
  } catch (e) {
    if (e instanceof CallError) {
      return {
        refused: { code: e.code, text: e.message },
        timing: c.header('tool_'),
      }
    }
    caught(e, toolTags(asked.tool, asked.args))
    return {
      timing: c.header('tool_'),
      refused: {
        code: 'unavailable',
        text: `${asked.tool} failed on our side, and we have been told: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    }
  }
}

/** The object: it holds no graph, only the answer nobody heard, in its
 * counted keys, and its one entry is `call`, this key's call joined or
 * begun. */
export class Outlast extends Durable {
  #once: ReturnType<typeof outlasting>
  #env: Env
  constructor(ctx: State, env: Env, time: Clock | undefined = env.CLOCK) {
    super(ctx, {
      report: (e, entry) => caught(e, { request: `outlast ${entry}` }),
    })
    this.#once = outlasting(this.keys, {
      ...time,
      report: (e) => caught(e, { request: 'keep tool result' }),
    })
    this.#env = env
  }
  call(asked: Asked): Promise<Heard> {
    return this.enter(
      'call',
      () =>
        asked.pickup
          ? this.#once.read(asked.pickup, asked.patience)
          : this.#once((doing) => ran(this.#env, asked, doing), asked.patience),
    )
  }
}
