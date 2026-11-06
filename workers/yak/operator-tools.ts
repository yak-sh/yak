import type { Args, Ctx, Tool } from './tool.ts'
import { inSpace, refuse, rejected, SPACE, str } from './tool.ts'
import { builderOf, SPACE as HEADER } from './build-door.ts'
import { writes } from '@yaks/member'
import { vouched } from './session.ts'

let ask = async (ctx: Ctx, args: Args, path: string) => {
  let { space, who } = await inSpace(ctx, args, path != '/operator/read', true)
  if (!writes(who.role)) {
    throw refuse('access', 'only a member who writes can read operator work')
  }
  let response = await builderOf(ctx.env, space.eid)(() =>
    new Request(`https://builder${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HEADER]: space.eid,
        ...vouched(who),
      },
      body: JSON.stringify(args),
    })
  )
  let value = await response.json() as Record<string, unknown>
  if (!response.ok) {
    throw rejected(response.status, String(value.message ?? value.error))
  }
  return { space, text: String(value.text ?? JSON.stringify(value)), value }
}

export let operatorTools: Omit<Tool, 'title' | 'description'>[] = [
  {
    name: 'operator_run',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        say: str(
          'What you want done in this space, or the design your agent prepared.',
        ),
        task: str(
          'The id of an existing operator task to continue. Omit for a new request.',
        ),
      },
    },
    run: (ctx, args) => ask(ctx, args, '/operator/run'),
  },
  {
    name: 'operator_read',
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        task: str(
          "The operator task id, or a conversation's session id. Omit to list the most recent tasks and conversations.",
        ),
        context: {
          type: 'boolean',
          description:
            'Include the model instruction snapshots beside transcript entries (omitted by default).',
        },
      },
    },
    run: (ctx, args) => ask(ctx, args, '/operator/read'),
  },
  {
    name: 'operator_remove',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            "The tasks, conversations' sessions, lines, wake-ups or subscriptions to remove, by eid or short id.",
        },
      },
      required: ['ids'],
    },
    run: (ctx, args) => ask(ctx, args, '/operator/remove'),
  },
  {
    name: 'operator_retry',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        request: str('The id of the operator request that could not finish.'),
      },
      required: ['request'],
    },
    run: (ctx, args) => ask(ctx, args, '/operator/retry'),
  },
]
