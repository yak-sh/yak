import type { Bundle } from '@yaks/graph'
import type { Args, Ctx, Tool } from './tool.ts'
import { inSpace, refuse, SPACE, str } from './tool.ts'
import { operatorDoor } from './build-door.ts'
import { writes } from '@yaks/member'

let ask = async (
  ctx: Ctx,
  args: Args,
  path: string,
  write = path != '/operator/read',
) => {
  if (write && ctx.remote === false) {
    throw refuse(
      'access',
      'A reply cannot start an authenticated Operator conversation.',
    )
  }
  let { space, who } = await inSpace(ctx, args, write, true)
  if (!writes(who.role)) {
    throw refuse('access', 'only a member who writes can read operator work')
  }
  let value = await operatorDoor(
    ctx.env,
    space,
    who,
    path.slice('/operator/'.length),
    args,
  ) as Record<string, unknown>
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
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        description:
          "How much the model reasons before it answers in this run. Omit for the model's default.",
      },
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

// What words given to a conversation name of themselves (@yaks/harness
// `conversation_start`, `conversation_send`).
let PROJECT = str('The space to talk with, by its slug or id.')
let SESSION = str(
  'The conversation, as conversation_start or conversation_recent names it.',
)
let given = {
  request: str(
    'Your own id for these words. Sending them again under it does nothing, so a retry never says them twice.',
  ),
  provider: str(
    "The provider whose model answers these words. Omit for the Operator's own.",
  ),
  model: str(
    "The model that answers these words. Omit for the Operator's own.",
  ),
  effort: {
    type: 'string',
    enum: ['low', 'medium', 'high', 'xhigh', 'max'],
    description:
      "How much that model reasons before it answers. Omit for the model's default.",
  },
  attachments: {
    type: 'array',
    items: { type: 'string' },
    description:
      'SHA-256 addresses of files already sent to your Operator, as attachment.artifact names them.',
  },
}
// A conversation tool of @yaks/harness's, run in the space's Operator store
// as the person (operator-conversations.ts `converse`).
let conversing = (
  name: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly = false,
): Omit<Tool, 'title' | 'description'> => ({
  name,
  ...readOnly ? { readOnly } : { destructive: true },
  input: {
    type: 'object',
    properties: { project: PROJECT, ...properties },
    required: ['project', ...required],
  },
  run: (ctx, { project, ...args }) =>
    ask(
      ctx,
      { space: project, tool: name, args },
      '/operator/talk',
      !readOnly,
    ),
})

export let operatorTools: Omit<Tool, 'title' | 'description'>[] = [
  chat,
  { ...chat, name: 'operator_run' },
  {
    name: 'conversation_projects',
    readOnly: true,
    input: { type: 'object', properties: {} },
    // The spaces the person may talk in: each where their seat writes.
    run: async (ctx) => ({
      text: '',
      value: {
        owner: ctx.person,
        projects: (await ctx.dir.seats(ctx.person))
          .filter((s) => writes(s.role) && !s.space.trashed)
          .map((s) => ({
            id: s.space.eid,
            title: s.space.title ?? s.space.slug,
          })),
      },
    }),
  },
  conversing('conversation_start', {
    prompt: str('Your first words.'),
    ...given,
  }, ['prompt']),
  conversing('conversation_send', {
    session: SESSION,
    text: str('Your words.'),
    ...given,
  }, ['session', 'text']),
  conversing(
    'conversation_read',
    {
      session: str(
        'The conversation, a helper or fork working under it, a task, or any line of one.',
      ),
      limit: { type: 'integer', minimum: 1, maximum: 256 },
      before: {
        type: 'integer',
        minimum: 1,
        description:
          'Read older messages strictly before this entry sequence. Omit to read the newest.',
      },
      lines: {
        type: 'boolean',
        description:
          'Answer every line, tool calls and results included, rather than only the messages.',
      },
      context: {
        type: 'boolean',
        description:
          'With lines, include the model instruction snapshots beside them (omitted by default).',
      },
      beforeLine: str(
        "With lines, a line as an answer's earlier.before names it, to read the lines before it.",
      ),
    },
    ['session'],
    true,
  ),
  conversing(
    'conversation_recent',
    {
      limit: { type: 'integer', minimum: 1, maximum: 256 },
    },
    [],
    true,
  ),
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
