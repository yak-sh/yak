// One app's stored commands and the effect boundary that runs one. The MCP
// command and a page's /api/command supply the same caller-scoped store acts;
// what a command answers is @yaks/platform/app-command's.
import type { ToolDef } from '@yaks/tools/declared'
import { CallError } from '@yaks/tools/errors'
import {
  type Acts,
  commandReply,
  listed,
  type Reply,
  workerReply,
} from '@yaks/platform/app-command'
import { type App, type Space } from './directory.ts'
import { commandWorker, workerBreak } from './dispatch.ts'
import type { Env } from './env.ts'
import { toolsOf } from './declaration.ts'
import type { Who } from './session.ts'

export { toolsOf } from './declaration.ts'

/** Commands this page caller can discover. Access is decided here, beside
 * commandIn. */
export let commandsIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
) => listed(await toolsOf(env, space, app), who)

/** A hosted command's dispatch boundary, preserving the recorded invocation
 * beside its scoped caller. A break of the app's worker is the app's, filed
 * once here whoever ran the command: a page, a connector or a schedule. */
export let commandAt = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  name: string,
  tool: ToolDef,
  args: Record<string, unknown>,
  door: Acts,
  execution: { call?: string; at?: string; source?: string } = {},
): Promise<Reply> => {
  let at = `${space.slug}/${app.slug}`
  return await commandReply(at, who, name, tool, args, {
    ...door,
    worker: async (path, args) =>
      workerReply(
        await commandWorker(env, space, app, who, path, args, {
          ...execution,
          report: (req, error) =>
            workerBreak(env, space, app, req, error, name),
        }),
        name,
        at,
      ),
  })
}

/** Invoke a named command in this app with the page caller's store acts. */
export let commandIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  name: string,
  args: Record<string, unknown>,
  door: Acts,
) => {
  let tool = (await toolsOf(env, space, app))[name]
  if (!tool) {
    throw new CallError(
      'missing',
      `no command ${name} in ${space.slug}/${app.slug}`,
    )
  }
  return commandAt(env, space, app, who, name, tool, args, door)
}
