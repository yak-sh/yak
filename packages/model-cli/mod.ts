/** Subscription-backed model turns through the vendor's local CLI. @module */
import {
  began,
  type Listed,
  type Model,
  ModelError,
  type Reply,
  type Request,
  submitted,
  UNANCHORED,
} from '@yaks/model'
import { type Run, run } from './process.ts'
import { protocols, type Vendor } from './protocol.ts'
import { items } from './turn.ts'

export type { Invocation, Output, Run } from './process.ts'
export type { Vendor } from './protocol.ts'

/** Non-secret host settings. Model names are the slugs the CLI shows. */
export type Options = { command?: string; models?: string[] }

let inherited = [
  'HOME',
  'PATH',
  'USER',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
]

let grokEnv = {
  GROK_STORAGE_MODE: 'local',
  GROK_MANAGED_MCPS_ENABLED: '0',
  ...Object.fromEntries(
    ['CLAUDE', 'CODEX', 'CURSOR'].flatMap((cli) =>
      ['HOOKS', 'MCPS'].map((
        feature,
      ) => [`GROK_${cli}_${feature}_ENABLED`, '0'])
    ),
  ),
}

let environment = (
  vendor: Vendor,
  env: (name: string) => string | undefined,
) => ({
  ...vendor == 'grok' ? grokEnv : {},
  ...Object.fromEntries(
    [...inherited, ...vendor == 'grok' ? ['GROK_HOME'] : []].flatMap((name) => {
      let value = env(name)
      return value == null ? [] : [[name, value]]
    }),
  ),
})

let validate = (req: Request, command: string) => {
  if (req.anchor) throw new ModelError(UNANCHORED)
  if (req.questions) {
    throw new ModelError('questions', `${command} answers no typed questions`)
  }
  if (
    req.input ||
    [...req.items, ...req.turnContext ?? []].some((i) => 'bytes' in i) ||
    req.modalities?.some((m) => m != 'text')
  ) {
    throw new ModelError(
      'cli_input',
      `${command} supports text and harness tools only`,
    )
  }
}

/** A native model. It lends the child no API key, receives one turn, then
 * hands any requested calls to the harness's ordinary tool loop. */
export let cliModel = (
  vendor: Vendor,
  options: Options,
  env: (name: string) => string | undefined,
  execute: Run = run,
): Model => {
  let protocol = protocols[vendor]
  let command = options.command ?? protocol.command
  let list = (): Promise<Listed[]> =>
    Promise.resolve(
      (options.models ?? []).map((name) => ({ name, modalities: ['text'] })),
    )
  return Object.assign(async (req: Request): Promise<Reply> => {
    validate(req, protocol.command)
    req.signal?.throwIfAborted()
    await submitted(req)
    let output = await execute({
      command,
      env: environment(vendor, env),
      signal: req.signal,
      ...protocol.invocation(req),
    }).catch((e) => {
      req.signal?.throwIfAborted()
      if ((e as { code?: string }).code == 'ENOENT') {
        throw new ModelError(
          'cli_missing',
          `Install ${protocol.command} on the harness host`,
        )
      }
      throw e
    })
    req.signal?.throwIfAborted()
    let turn = protocol.read(output, req)
    let reply = items(turn.output, turn.id, protocol.command)
    began(req)
    for (let item of reply) {
      if (item.kind == 'assistant') {
        req.onText?.({ index: 0, id: turn.id, text: item.text })
      }
    }
    return {
      id: turn.id,
      model: turn.model ?? req.model,
      items: reply,
      usage: turn.usage,
    }
  }, { list })
}
