// The object a call that outlasts its caller runs in (outlast.ts, index.ts
// `Outlast`): one per caller, tool and target. It runs the tool as the door
// would, as the person and through the credential the door verified, with
// the directory opened afresh as mcp.ts opens it.
import { CallError } from '@yaks/tools/errors'
import { running } from './agent.ts'
import { caught } from './defects.ts'
import { copyOf } from './directory-copy.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { narrowed } from './grants.ts'
import { type Asked, type Ended, type Keep, outlasting } from './outlast.ts'
import type { Ctx } from './tool.ts'
import { TOOLS } from './tools.ts'

let ran = async (env: Env, asked: Asked): Promise<Ended> => {
  let t = TOOLS.find((one) => one.name == asked.tool)
  if (!t) return { refused: { code: 'missing', text: `no tool ${asked.tool}` } }
  let space = asked.who?.space
  let reopen = () => {
    let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    })
    return space ? narrowed(dir, space, asked.who?.spaceEid) : dir
  }
  let ctx: Ctx = {
    env,
    dir: reopen(),
    reopen,
    person: asked.person,
    ...asked.who ? { who: asked.who } : {},
  }
  try {
    return { said: await running(ctx, t)(asked.args, asked.call) }
  } catch (e) {
    if (e instanceof CallError) {
      return { refused: { code: e.code, text: e.message } }
    }
    caught(e, { tool: asked.tool })
    return {
      refused: {
        code: 'unavailable',
        text: `${asked.tool} failed on our side, and we have been told: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    }
  }
}

/** The object's one method: this key's call, joined or begun. */
export let outlast = (keep: Keep, env: Env) => {
  let once = outlasting(keep)
  return (asked: Asked) => once(() => ran(env, asked))
}
