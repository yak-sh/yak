// Running one of an app's commands (./app-commands.ts) for a caller, whatever
// reaches the store and the app's worker: yaks.app's page door, its connector
// and its stores each lend the acts, and the answer is the same words and
// value for all of them.
import { invoke, mayCall, type ToolDef, type Tools } from '@yaks/tools/declared'
import { CallError } from '@yaks/tools/errors'
import { display } from '@yaks/tools/display'
import { legacyOptions } from '@yaks/vocab/tools'
import type { Bundle } from '@yaks/graph'

/** Who runs a command: the person, and their role in the app. */
export type Caller = { person: string | null; role: string | null }

/** A command's answer: what is said, and the value beside it. It is `heard`
 * unless its words are only the receipt of a write: the rows a query shows
 * and a worker's words are whoever wrote them, which a caller that narrows
 * what it does after reading outsiders' words hears as theirs. */
export type Reply = {
  text: string
  value: Record<string, unknown>
  heard?: true
}

/** What a command reaches through its caller: the store's writes and reads,
 * and the app's worker where its host has one. */
export type Acts = {
  apply: (
    mutation: { entities: Bundle[] },
  ) => Promise<{ entities: string[]; aliases: Record<string, string> }>
  query: (line: string) => Promise<unknown>
  worker?: (path: string, args: Record<string, unknown>) => Promise<Reply>
}

/** Keep the worker's bytes for clients and show JSON as readable fields. */
export let workerReply = async (
  res: Response,
  name: string,
  at: string,
): Promise<Reply> => {
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

/** A command as a page is shown it: the fields it needs to present and fill
 * one. */
export type Listed =
  & Pick<ToolDef, 'description' | 'input' | 'required' | 'positional' | 'model'>
  & { options?: ReturnType<typeof legacyOptions> }

/** The commands `who` can discover, as a page is shown them. */
export let listed = (tools: Tools, who: Caller): Record<string, Listed> =>
  Object.fromEntries(
    Object.entries(tools)
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
 * answer shape whether its graph is local or hosted. `at` is the app's
 * address, which the answer names. */
export let commandReply = async (
  at: string,
  who: Caller,
  name: string,
  tool: ToolDef,
  args: Record<string, unknown>,
  door: Acts,
): Promise<Reply> => {
  if (!mayCall(tool.floor, who.person, who.role)) {
    throw new CallError('access', `${name} requires the app ${tool.floor}`)
  }
  return await invoke<Reply>(tool, args, {
    worker: async (path, args) => {
      if (!door.worker) throw new Error('app worker is unavailable')
      return { ...await door.worker(path, args), heard: true }
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
        heard: true,
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
  })
}
