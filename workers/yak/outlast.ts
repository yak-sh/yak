// A call that outlasts its caller (T-141686). An agent's client waits about a
// minute for a tool call (the claude.ai connector said "The operation timed
// out." at 60 s), and a release can take longer: one that compiles in a cold
// container, or again under a compiler rollout, released jeff/yak-sh v42 92 s
// after it was asked, to a caller that had heard a timeout. A Worker cannot
// finish work after it answers (`waitUntil` lends 30 s), so a tool that may
// take longer than its caller waits (tools.ts `outlasts`) runs in a Durable
// Object, one per caller, tool and arguments (index.ts `Outlast`), where pending
// I/O keeps the object up until the work ends (wrangler.toml
// `durable_object_io_tasks_prevent_eviction`).
//
// The door waits {@link PATIENCE} for it, and within that the answer is the
// tool's own. Past it, the answer says the call is still running, and what it
// is doing, where the tool has said (tool.ts `Ctx.doing`). The next
// call with the same key joins a run still going, or is handed the answer of
// one nobody heard, once, in place of running again.
import type { Bundle } from '@yaks/graph'
import type { Heard } from '@yaks/tools/outlast'
import { CallError } from '@yaks/tools/errors'
import type { Caller } from './session.ts'
import { opened, seal } from './lib/token.ts'

/** A call, as the door hands it to the object: the tool, what it was asked,
 * and who asked through which credential. */
export type Asked = {
  tool: string
  args: Record<string, unknown>
  call?: string
  person: string
  who?: Caller
  patience?: number
  /** Read this run's answer without starting any work. */
  pickup?: string
}

/** The objects calls outlast their callers in (index.ts `Outlast`). */
export type Outlasts = {
  idFromName(name: string): unknown
  get(id: unknown): { call(asked: Asked): Promise<Heard> }
}

let said = (body: string, value?: Record<string, unknown>, call?: string) => [{
  entity: { eid: '$said' },
  content: { body },
  output: { ...call ? { source: call } : {}, ...value ? { value } : {} },
}]

// A late answer is the run a caller was told to call again for, which ended
// between its calls: this call started nothing, and the next one runs anew.
// It never says the run is still going, so a caller polling for that ends.
let earlier = (name: string, asked: string) =>
  `This is how the ${name} asked at ${asked} with the same arguments ended; ` +
  'it ended between calls, so this call started nothing. Changes made ' +
  `after it was asked are not in it: call ${name} again to run it anew.\n`

type Result = {
  key: string
  tool: string
  asked: string
  person: string
  scope: string | null
}

let scopeOf = (who?: Caller) => who?.spaceEid ?? who?.space ?? null

/** The door's half: the call, run in the object for its key, and its answer
 * as the caller hears it. */
export let outlasted = async (
  objects: Outlasts,
  key: string,
  asked: Asked,
  progress?: string,
  secret?: string,
  include?: (header: string) => void,
): Promise<Bundle[]> => {
  let name = asked.tool
  let heard = await objects.get(objects.idFromName(key)).call(asked)
  if ('running' in heard) {
    let { running, doing } = heard
    let handle = secret && await seal(
      'tool-result',
      {
        key,
        tool: name,
        asked: running,
        person: asked.person,
        scope: scopeOf(asked.who),
      } satisfies Result,
      secret,
    )
    return said(
      (doing
        ? `${name} asked at ${running} is still running: ${doing}.`
        : progress ??
          `${name} asked at ${running} is still running, and goes on.`) +
        (handle ? ' Use result_wait with the result_handle. ' : ' ') +
        `Call ${name} again with the same arguments to wait for it and hear ` +
        'how it ended.',
      {
        running: true,
        asked: running,
        ...doing ? { doing } : {},
        ...handle ? { result_handle: handle } : {},
      },
      asked.call,
    )
  }
  if (heard.timing) include?.(heard.timing)
  let before = heard.late ? earlier(name, heard.asked) : ''
  if ('refused' in heard) {
    throw new CallError(heard.refused.code, before + heard.refused.text)
  }
  return heard.said.map((b) => {
    let content = b.content as { body?: string } | undefined
    return before && content
      ? { ...b, content: { ...content, body: before + (content.body ?? '') } }
      : b
  })
}

/** A handle belongs to the person and credential scope that started the run. */
export let resultOf = async (
  objects: Outlasts | undefined,
  secret: string | undefined,
  handle: string,
  person: string | null,
  who?: Caller,
  call?: string,
  include?: (header: string) => void,
): Promise<Bundle[]> => {
  let result = secret && person &&
    await opened<Result>('tool-result', handle, secret)
  if (
    !objects || !result || result.person != person ||
    result.scope != scopeOf(who)
  ) {
    throw new CallError('missing', 'No pending tool result with that handle.')
  }
  return outlasted(
    objects,
    result.key,
    {
      tool: result.tool,
      person: result.person,
      who,
      call,
      args: {},
      pickup: result.asked,
    },
    undefined,
    secret,
    include,
  )
}
