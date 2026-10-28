// Lifecycle events use the ordinary tool runner, so HTTP and local fallback
// create the same sessions, calls and claims. Only the harness reply differs:
// command stdout carries the JSON additionalContext supported by Claude Code.
import type { Graph } from '@yaks/graph'
import type { Authenticate } from '@yaks/api'
import type { Runner } from '@yaks/tools'
import type { Host } from '@yaks/host'
import { answerOf, faulted, toolEid } from '@yaks/tools/result'

export let lifecycle = async (
  host: {
    graph: Graph
    runner?: Runner
    who?: Authenticate
    text?: Host['text']
  },
  request: Request,
  hook: Record<string, unknown>,
): Promise<Response | undefined> => {
  let event = hook.hook_event_name
  if (
    !['SessionStart', 'SubagentStart', 'SessionEnd'].includes(String(event))
  ) {
    return undefined
  }
  if (!host.runner) throw new Error('lifecycle hooks need a tool runner')
  let tool = event == 'SessionEnd' ? 'session_wrap' : 'session_context'
  await host.runner.ensure([tool])
  let id = crypto.randomUUID()
  let actor = await host.who?.(request)
  let landed = await host.runner.call({
    entity: { eid: id },
    call: { to: toolEid(tool), args: { hook: JSON.stringify(hook) } },
    ...(actor ? { $actor: actor } : {}),
  })
  if (faulted(landed, id)) return new Response('', { status: 500 })
  if (!host.text) throw new Error('lifecycle hooks need a text renderer')
  let text = await host.text(answerOf(landed, id), true)
  return Response.json(
    text && event != 'SessionEnd'
      ? {
        hookSpecificOutput: { hookEventName: event, additionalContext: text },
      }
      : {},
  )
}
