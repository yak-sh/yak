import { ModelError, type Request, type Usage } from '@yaks/model'
import type { Invocation, Output } from './process.ts'
import { instructions, json, object, prompt, schema } from './turn.ts'

/** Vendor CLI name under which the harness serves the model. */
export type Vendor = 'grok' | 'gemini'

type Command = Pick<Invocation, 'args' | 'files' | 'stdin'>
type Turn = { id: string; model?: string; output: unknown; usage?: Usage }
type Protocol = {
  command: string
  invocation: (req: Request) => Command
  read: (output: Output, req: Request) => Turn
}

let HOUR = 60 * 60 * 1000
let grokSpent =
  /subscription:free-usage-exhausted|usage_pool_exhausted|usage_limit_reached|usage limit (?:for now|reached)|(?:hit|reached) the rate limit for your plan|out of credits/i
let googleSpent =
  /\bquota\b.{0,30}\b(?:exceeded|exhausted|reached)\b|\b(?:exhausted|reached)\b.{0,24}\bquota\b|usage limit reached/i

// Diagnostics can include a prompt, auth URL or settings. Only the recognized
// failure category leaves the process boundary.
let failure = (
  command: string,
  detail: string,
  code: number,
  spent: RegExp,
) => {
  if (spent.test(detail)) {
    return new ModelError(
      'usage_limit_reached',
      `${command} reports that its plan quota is exhausted`,
      { after: HOUR, defer: true },
    )
  }
  if (
    /not signed in|authentication required|please (?:sign|log) in|not authenticated/i
      .test(detail)
  ) {
    return new ModelError(
      'cli_auth',
      `Sign in with ${command} on the harness host`,
    )
  }
  if (
    /rate.limit|\b429\b|resource_exhausted|temporarily unavailable|no capacity/i
      .test(detail)
  ) {
    return new ModelError('busy', `${command} is temporarily unavailable`, {})
  }
  return new ModelError(
    'cli_failed',
    `${command} failed to answer (exit ${code})`,
  )
}

let count = (value: unknown, grok: boolean): Usage | undefined => {
  let row = object(value)
  if (
    !row || typeof row.input_tokens != 'number' ||
    typeof row.output_tokens != 'number'
  ) return
  let cached = row.cache_read_input_tokens ?? row.cache_read_tokens
  let written = row.cache_creation_input_tokens
  let input = row.input_tokens +
    (grok && typeof cached == 'number' ? cached : 0) +
    (grok && typeof written == 'number' ? written : 0)
  return {
    input_tokens: input,
    output_tokens: row.output_tokens,
    total_tokens: input + row.output_tokens,
    ...typeof cached == 'number' ? { cached_tokens: cached } : {},
    ...typeof written == 'number' ? { cache_write_tokens: written } : {},
  }
}

let grok: Protocol = {
  command: 'grok',
  invocation: (req) => ({
    args: [
      '--prompt-file',
      'request.txt',
      '--model',
      req.model,
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--system-prompt-override',
      instructions,
      '--verbatim',
      '--tools',
      'search_tool',
      '--disallowed-tools',
      'search_tool,use_tool,Agent',
      '--permission-mode',
      'dontAsk',
      '--max-turns',
      '1',
      '--no-plan',
      '--no-subagents',
      '--no-memory',
      '--no-auto-update',
      ...req.effort ? ['--effort', req.effort] : [],
    ],
    files: { 'request.txt': prompt(req) },
  }),
  read: ({ stdout, stderr, code }) => {
    let frame = json(stdout)
    if (code || frame?.type == 'error') {
      throw failure(
        'grok',
        `${frame?.message ?? ''}\n${stderr}`,
        code,
        grokSpent,
      )
    }
    if (frame?.stopReason != 'end_turn' || !frame.structuredOutput) {
      throw new ModelError(
        'cli_protocol',
        'grok did not return a complete model turn',
      )
    }
    let id = frame.requestId || frame.sessionId
    if (typeof id != 'string' || !id) {
      throw new ModelError(
        'cli_protocol',
        'grok did not return a request or session id',
      )
    }
    let models = Object.keys(object(frame.modelUsage) ?? {})
    return {
      id,
      output: frame.structuredOutput,
      model: models.length == 1 ? models[0] : undefined,
      usage: count(frame.usage, true),
    }
  },
}

let agyAgent = 'yak-native-turn'
let agent = [
  '---',
  `name: ${agyAgent}`,
  'description: Answer one model turn for the native harness.',
  'tools: []',
  'subagent: false',
  'inheritMcp: false',
  'inheritCustomizations: false',
  'commandExecutionPolicy: off',
  '---',
  instructions,
  '',
].join('\n')

let gemini: Protocol = {
  command: 'agy',
  invocation: (req) => ({
    args: [
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--model',
      req.model,
      '--agent',
      agyAgent,
      '--disable-slash-commands',
      '--json-schema',
      schema,
      '--settings',
      JSON.stringify({
        modelProvider: '',
        useG1Credits: false,
        toolPermission: 'strict',
        permissions: {
          deny: [
            'read_file(*)',
            'write_file(*)',
            'command(*)',
            'read_url(*)',
            'execute_url(*)',
            'mcp(*)',
          ],
        },
      }),
      ...req.effort ? ['--effort', req.effort] : [],
    ],
    files: { [`.agents/agents/${agyAgent}.md`]: agent },
    stdin:
      JSON.stringify({ event: 'user', message: { content: prompt(req) } }) +
      '\n',
  }),
  read: ({ stdout, stderr, code }) => {
    let frames = stdout.split('\n').filter((l) => l.trim()).map(json)
    let init = object(frames.find((f) => f?.event == 'init')?.init)
    let result = object(frames.findLast((f) => f?.event == 'result')?.result)
    if (code || result && result.status != 'SUCCESS') {
      throw failure(
        'agy',
        `${result?.error ?? ''}\n${stderr}`,
        code,
        googleSpent,
      )
    }
    if (typeof result?.conversation_id != 'string' || !result.conversation_id) {
      throw new ModelError(
        'cli_protocol',
        'agy did not return a complete model turn',
      )
    }
    return {
      id: result.conversation_id,
      output: result.structured_output,
      model: typeof init?.model == 'string' ? init.model : undefined,
      usage: count(result.usage, false),
    }
  },
}

export let protocols: Record<Vendor, Protocol> = { grok, gemini }
