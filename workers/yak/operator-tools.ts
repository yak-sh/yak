import type { Bundle } from '@yaks/graph'
import type { Args, Ctx, Tool } from './tool.ts'
import { inSpace, refuse, rejected, SPACE, str } from './tool.ts'
import { builderOf, SPACE as HEADER } from './build-door.ts'
import { writes } from '@yaks/member'
import { vouched } from './session.ts'

let ask = async (
  ctx: Ctx,
  args: Args,
  path: string,
  write = path != '/operator/read',
) => {
  let { space, who } = await inSpace(ctx, args, write, true)
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
  // A request's answer is words, said once beside the rest of its value; a
  // conversation's read is its value alone.
  let { text, ...rest } = value
  return typeof text == 'string'
    ? { space, text, value: rest }
    : { space, text: '', value }
}

/** A tool on the space's tasks and goals, run in its Operator's store
 * (operator-tasks.ts `working`), answering the bundles it applied there. */
export let operatorWork = async (
  ctx: Ctx,
  name: string,
  { space, ...args }: Args,
  write: boolean,
): Promise<Bundle[]> =>
  (await ask(ctx, { space, tool: name, args }, '/operator/tool', write))
    .value as unknown as Bundle[]

let chat: Omit<Tool, 'title' | 'description'> = {
  name: 'operator_chat',
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
      provider: str('The configured model provider to use for this run.'),
      model: str('The model the selected provider lists for this run.'),
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description:
          'SHA-256 addresses of files already sent to your Operator, as attachment.artifact names them.',
      },
    },
  },
  run: (ctx, args) => ask(ctx, args, '/operator/run'),
}

export let operatorTools: Omit<Tool, 'title' | 'description'>[] = [
  chat,
  { ...chat, name: 'operator_run' },
  {
    name: 'helper_spawn',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        task: str('The private task or session returned by operator_chat.'),
        title: str(
          'A short name for the job, 3 to 6 words, as a person would name it. The chat’s list of helpers shows it.',
        ),
        brief: str('The work for the helper to do, with the context it needs.'),
        model: str('The model to use. Omit for the Operator’s default model.'),
      },
      required: ['task', 'brief'],
    },
    run: (ctx, args) => ask(ctx, args, '/operator/helper'),
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
        before: str(
          "An entry of the conversation, as an answer's earlier.before names it, to read the 64 lines before it.",
        ),
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
    name: 'operator_stop',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        task: str("The operator task, or a conversation's session, to stop."),
      },
      required: ['task'],
    },
    run: (ctx, args) => ask(ctx, args, '/operator/stop'),
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
