// Cloudflare's wrangler, as every door that runs it needs it: the pinned
// version and where it is installed, the subcommand an argument list names,
// what a failed run throws, and the retry that rides out a passing outage of
// Cloudflare's API. Each Worker keeps its own door, its own wrangler.toml and
// its own steps; this package owns only what they share.
//
// The pin is this package's `wrangler` dependency, and every caller runs that
// installed package. It has a floor, not just a version: `send_email` is Email
// Sending's binding now, whose `send()` takes `{from, to, subject, text,
// html}` and answers `{messageId}`, and miniflare only grew that shape late —
// 4.42.2's stand-in knew the old Email Routing binding alone and bounced every
// letter with `could not parse email` (T-34179). Never pin below a wrangler
// whose miniflare simulates the builder; yaks.app's mail_test.ts holds it.
//
// Measure yaks.app's kernel probes before moving it: 4.128.0 booted them three
// times slower and dropped kernels under parallel load (`Network connection
// lost`); 4.158.0 runs them at 4.111.0's pace.
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import pinned from 'wrangler/package.json' with { type: 'json' }
import { backoff, sleep } from '@yaks/fp'

export let WRANGLER_VERSION = pinned.version
export let WRANGLER = [
  'node',
  fileURLToPath(
    new URL(pinned.bin.wrangler, import.meta.resolve('wrangler/package.json')),
  ),
]

export let command = (args: string[]) => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] == '--env' || args[i] == '-e') i++
    else if (!args[i].startsWith('--env=')) return args[i]
  }
}

export type StepResult = { code: number; output: string; log?: string }

// The containers API's client words every HTTP 500 it gets this way, and
// prints no request or status beside it.
let INTERNAL = /^\s*There has been an internal error\b/

// Final API errors a new Wrangler process gets past. Asset completion tokens
// are single-use (100312): a new process starts a fresh upload session rather
// than resubmitting the consumed token. A version just uploaded can stay
// unreadable past Wrangler's own two seconds of asking (100146): a new process
// uploads it again.
let RACED = /\[code: (?:100146|100312)\]/

// Asset uploads are authorized by the upload session's own JWT, not the
// deploy's token: their 401 refuses the session, and a new process opens
// another.
let SESSION = /\/workers\/assets\/upload\b/

// JSON API errors hide their HTTP status on the console. Wrangler's sanitized
// debug file records it even at normal verbosity. Use the last response before
// the final API error, never an earlier request that Wrangler recovered from.
let REQUEST =
  /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S+) -> (\d{3})\b[^\n]*/
let transient = ({ output, log = '' }: StepResult) => {
  output = stripVTControlCharacters(output).split('[ERROR]').at(-1)!
  if (INTERNAL.test(output)) return true
  let malformed = output.includes('Received a malformed response from the API')
  let failed = /A request to the Cloudflare API(?: \([^\n]+\))? failed\./.exec(
    output,
  )
  if (!malformed && !failed) return false
  if (failed && RACED.test(output)) return true
  let request = REQUEST.exec(output)
  if (request?.[2] == '401' && SESSION.test(request[1])) return true
  let status = request?.[2]
  if (!status) {
    let at = log.lastIndexOf(
      failed?.[0] ?? 'Received a malformed response from the API',
    )
    let before = at < 0 ? log : log.slice(0, at)
    status = [
      ...before.matchAll(/-- START CF API RESPONSE:[^\n]*\b(\d{3})\s*$/gm),
    ]
      .at(-1)?.[1]
  }
  return status
    ? status.startsWith('5') || (malformed && Number(status) < 400)
    : malformed
}

/** What a failed Wrangler run throws. Cloudflare's API failing is one
 * fault, whichever endpoint and caller met it, so one outage files one bug. */
export let failure = (args: string[], result: StepResult): Error => {
  let output = stripVTControlCharacters(result.output)
  if (!transient(result)) {
    return new Error(
      `wrangler ${command(args)} exited ${result.code}: ${output}`,
    )
  }
  let request = REQUEST.exec(output)?.[0]
  return Object.assign(
    new Error(`Cloudflare's API failed${request ? `: ${request}` : ''}`),
    { fault: 'cloudflare api failed' },
  )
}

/** Run Wrangler until it succeeds, fails for good, or a passing Cloudflare
 * API outage outlasts `attempts`, each retry waiting longer than the last. An
 * interrupted run (130, 143) is never retried; `execute` sees an aborted
 * signal itself, since `wait` returns as soon as it aborts. This is the one
 * place a transient API failure is retried, for every deploy door and for
 * every read the box makes. */
export let retried = async <T extends StepResult>(
  args: string[],
  execute: () => Promise<T>,
  { wait = sleep, signal, attempts = 3 }: {
    wait?: typeof sleep
    signal?: AbortSignal
    attempts?: number
  } = {},
): Promise<T> => {
  for (let attempt = 1;; attempt++) {
    let result = await execute()
    if (
      !result.code || result.code == 130 || result.code == 143 ||
      attempt >= attempts || !transient(result)
    ) return result
    let ms = backoff(attempt)
    console.log(
      `Temporary Cloudflare API failure; retrying Wrangler ${
        command(args)
      } (attempt ${attempt + 1}/${attempts}) in ${ms / 1000}s`,
    )
    await wait(ms, signal)
  }
}

/// beganIn(versionMessage('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be A subject', new Date(0))) -> 0
/// beganIn('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be A subject') -> undefined
/** A version's message: its commit and subject, then when the deploy door
 * began the deploy that made it. Cloudflare cuts a deployment's copy to 50
 * characters, so the `began:` line lives on the version alone. */
export let versionMessage = (commit: string, began: Date) =>
  `${commit}\nbegan:${began.toISOString()}`

/** When the deploy door began the deploy that made a version (ms), as its
 * message's `began:` line says; a version deployed before the line, nothing. */
export let beganIn = (message?: string): number | undefined => {
  let at = Date.parse(message?.match(/^began:(\S+)$/m)?.[1] ?? '')
  return Number.isFinite(at) ? at : undefined
}
