// One app's stored commands and the effect boundary that runs one. The MCP
// command and a page's /api/command supply the same caller-scoped store acts.
import { invoke, mayCall, type ToolDef, type Tools } from '@yaks/tools/declared'
import { CallError } from '@yaks/tools/errors'
import { display } from '@yaks/tools/display'
import { legacyOptions } from '@yaks/vocab/tools'
import { type Bundle } from '@yaks/graph'
import { type App, type Space } from './directory.ts'
import { commandWorker, workerBreak } from './dispatch.ts'
import type { Env } from './env.ts'
import { declarationOf } from './declaration.ts'
import type { Who } from './session.ts'

type Acts = {
  apply: (
    mutation: { entities: Bundle[] },
  ) => Promise<{ entities: string[]; aliases: Record<string, string> }>
  query: (line: string) => Promise<unknown>
  worker?: (
    path: string,
    args: Record<string, unknown>,
  ) => Promise<{ text: string; value: Record<string, unknown> }>
}

/** Keep the worker's bytes for clients and show JSON as readable fields. */
export let workerReply = async (res: Response, name: string, at: string) => {
  let answer = await res.text()
  let mime = res.headers.get('content-type')?.split(';')[0].trim()
    .toLowerCase()
  let json = mime == 'application/json' || mime?.endsWith('+json')
  return {
    text: json && answer
      ? `${name}: answered in ${at}\n\n${display(JSON.parse(answer))}`
      : `${name}: ${answer || 'done'} in ${at}`,
    value: { answer },
  }
}

// A row as a command answers it: the entity's id, its kind and its
// components. The store's read also carries its own bookkeeping, the
// archetype the entity's tables are filed under and the `$` keys (a body's
// read token, `$was`), and none of it is the row's data. A model reads every
// field it is handed as data, and may copy it into its next write.
let said = (row: unknown): unknown => {
  if (!row || typeof row != 'object' || Array.isArray(row)) return row
  let out = Object.fromEntries(
    Object.entries(row).filter(([k]) => !k.startsWith('$')),
  )
  let entity = out.entity as Record<string, unknown> | undefined
  if (entity && 'archetype' in entity) {
    let { archetype: _, ...rest } = entity
    out.entity = rest
  }
  return out
}

export let toolsOf = async (
  env: Env,
  space: Space,
  app: App,
): Promise<Tools> => {
  return (await declarationOf(env, space, app)).tools
}

/** Commands this page caller can discover, with only the fields a page needs
 * to present and fill one. Access is decided here, beside commandIn. */
export let commandsIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
) =>
  Object.fromEntries(
    Object.entries(await toolsOf(env, space, app))
      .filter(([, tool]) =>
        tool.discoverable !== false && mayCall(tool.floor, who.person, who.role)
      )
      .map(([name, tool]) => {
        let options = legacyOptions({
          positional: tool.positional,
          inputSchema: { properties: tool.input },
        })
        return [name, {
          description: tool.description,
          input: tool.input,
          required: tool.required,
          ...(tool.positional ? { positional: tool.positional } : {}),
          ...(Object.keys(options).length ? { options } : {}),
          model: tool.model,
        }]
      }),
  )

/** Invoke a command through its caller's acts, with one authorization and
 * answer shape whether its graph is local or hosted. */
export let commandReply = async (
  at: string,
  who: Who,
  name: string,
  tool: ToolDef,
  args: Record<string, unknown>,
  door: Acts,
): Promise<{ text: string; value: Record<string, unknown> }> => {
  if (!mayCall(tool.floor, who.person, who.role)) {
    throw new CallError('access', `${name} requires the app ${tool.floor}`)
  }
  return await invoke<{ text: string; value: Record<string, unknown> }>(
    tool,
    args,
    {
      worker: (path, args) => {
        if (!door.worker) throw new Error('app worker is unavailable')
        return door.worker(path, args)
      },
      query: async (line) => {
        let read = await door.query(line)
        let rows = Array.isArray(read) ? read.map(said) : read
        let n = Array.isArray(rows) ? rows.length : 1
        return {
          text: `${name}: ${
            Array.isArray(rows) ? `${n} ${n == 1 ? 'row' : 'rows'}` : 'answered'
          } in ${at}\n\n${display(rows)}`,
          value: { rows },
        }
      },
      apply: async (bundles) => {
        let { entities, aliases } = await door.apply({ entities: bundles })
        // Each entity written, by the alias it was minted under where it had
        // one: the words carry what the data does.
        let named = new Set(Object.values(aliases))
        let said = [
          ...Object.entries(aliases).map(([alias, eid]) => `${alias}=${eid}`),
          ...entities.filter((eid) => !named.has(eid)),
        ]
        return {
          text: `${name}: wrote ${entities.length} ${
            entities.length == 1 ? 'entity' : 'entities'
          } in ${at}${said.length ? `: ${said.join(', ')}` : ''}`,
          value: { entities, aliases },
        }
      },
    },
  )
}

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
): Promise<{ text: string; value: Record<string, unknown> }> => {
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
