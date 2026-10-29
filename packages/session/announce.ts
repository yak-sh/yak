// Which run makes each of a harness's tool calls, as the harness's hook said
// just before the call (Claude Code's `PreToolUse`, posted to the hook door,
// ./routes.ts). One harness process serves a session and all its subagents
// over one MCP connection, so a call reaching the MCP door says nothing of who
// made it except the harness's own id for the call, which Claude Code sends in
// the request's `_meta` (`claudecode/toolUseId`). The hook is the one report
// that pairs that id with the session and the subagent behind it.
//
// The graph keeps the pairing: a hook and its call can reach different
// processes, including either side of a ready-first restart.

import type { Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { sessionFor, speaking, subagentSession } from './who.ts'

let announcement = (call: string): Eid => identityEid('announced', [call])

/** Remember that `run` makes the harness's call `call`. */
export let announce = async (
  graph: Graph,
  call: string,
  run: Eid,
): Promise<void> => {
  await graph.apply([{
    entity: { eid: announcement(call) },
    announced: { call, session: run },
    $actor: await speaking(graph, { entity: { eid: run } }),
  }], { trusted: true })
}

/** The run that makes the harness's call `call`, where its hook said. */
export let announced = async (
  graph: Graph,
  call: string,
): Promise<Eid | undefined> => {
  let [row] = await graph.get([announcement(call)], ['announced'])
  let named = row?.announced as { session?: Eid } | undefined
  return named?.session
}

/** Forget a call whose result the harness reported. */
export let forget = async (graph: Graph, call: string): Promise<void> => {
  let run = await announced(graph, call)
  if (!run) return
  await graph.apply([{
    entity: { eid: announcement(call) },
    announced: null,
    $actor: await speaking(graph, { entity: { eid: run } }),
  }], { trusted: true })
}

/**
 * The harness's id for the tool call a JSON-RPC message makes: Claude Code's
 * `claudecode/toolUseId` in the message's `_meta`.
 *
 * ```ts
 * import { callIn } from '@yaks/session/graph'
 * import { assertEquals } from '@std/assert'
 *
 * let message = {
 *   method: 'tools/call',
 *   params: { name: 'graph_show', _meta: { 'claudecode/toolUseId': 'toolu_1' } },
 * }
 * assertEquals(callIn(message), 'toolu_1')
 * assertEquals(callIn({ method: 'tools/list' }), undefined)
 * ```
 */
export let callIn = (message: unknown): string | undefined => {
  let params = (message as { params?: { _meta?: Record<string, unknown> } })
    ?.params
  let id = params?._meta?.['claudecode/toolUseId']
  return typeof id == 'string' && id ? id : undefined
}

/** What a harness hook says of one tool call (Claude Code's field names). */
export type Heard = {
  hook_event_name?: unknown
  tool_use_id?: unknown
  session_id?: unknown
  agent_id?: unknown
}

let str = (v: unknown): string => typeof v == 'string' ? v : ''

/**
 * Hear a hook event about a tool call: before the call (`PreToolUse`), the run
 * that makes it is remembered, a subagent's session written where the graph
 * has not met it; once a result is reported, the call is forgotten. Answers
 * whether the event was a call's announcement, which asks for no answer.
 */
export let hear = async (graph: Graph, hook: Heard): Promise<boolean> => {
  let call = str(hook.tool_use_id)
  if (!call) return false
  if (hook.hook_event_name != 'PreToolUse') {
    await forget(graph, call)
    return false
  }
  let session = str(hook.session_id)
  let agent = str(hook.agent_id)
  let run = agent
    ? await subagentSession(graph, session, agent)
    : session
    ? (await sessionFor(graph, session, ['session.id']))?.entity.eid
    : undefined
  if (run) await announce(graph, call, run)
  return true
}
