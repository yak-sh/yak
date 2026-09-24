// What makes two failures the same failure, and which ones are worth a task.
// Pure functions of text, so the storm-proofing is tested without a graph.
//
// A storm varies the volatile parts of a message — ids, timestamps, paths,
// line numbers, hashes, counters — while the fault stays the same. Taking
// those out leaves the fault's shape, and that shape plus the broken entity's
// kind and the top of the stack is the key one open bug is filed under.

/**
 * A message with its volatile parts replaced by `#`.
 *
 * ```ts
 * import { normalize } from '@yaks/heal'
 *
 * normalize('T-42 failed at /srv/app.ts:10:3 after 300 tries')
 * // '# failed at # after # tries'
 * ```
 */
export let normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      '#',
    )
    .replace(/\b[a-z]-\d+\b/g, '#') // human ids: T-3, S-45
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '#') // iso timestamps
    .replace(/\/[^\s:]+/g, '#') // absolute paths
    .replace(/:\d+(:\d+)?/g, '#') // :line:col
    .replace(/\b[0-9a-f]{6,}\b/g, '#') // hex blobs, short hashes
    .replace(/(?<![a-z0-9])\d+\b/g, '#') // numbers, and a suffix like tx_947
    .replace(/#+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()

// The first frame of a stack, so two failures at one site key together even
// when their messages differ. Empty when there is no stack (a process that
// died carries none); the key then rests on the kind and the message.
let head = (stack?: string | null): string => {
  if (!stack) return ''
  let lines = stack.split('\n').map((l) => l.trim())
  return normalize(lines.find((l) => l.startsWith('at ')) ?? lines[0] ?? '')
}

/**
 * The key one open bug is filed under: the broken entity's kind, the
 * normalized message, and the normalized top frame of the stack.
 *
 * ```ts
 * import { faultKey } from '@yaks/heal'
 *
 * faultKey('session', 'exit 127 in S-9', 'Error\n    at run (/a.ts:4:1)')
 * // 'session:exit # in #@at run (#)'
 * ```
 */
export let faultKey = (
  kind: string,
  message: string,
  stack?: string | null,
): string => {
  let top = head(stack)
  return `${kind}:${normalize(message)}${top ? `@${top}` : ''}`
}

// Failures that clear on their own. A task for one is noise; teach a new
// transient by adding a line.
let transient = [
  /timed? ?out|timeout/i,
  /temporarily unavailable|try again|rate limit/i,
  /econnreset|econnrefused|socket hang up|network/i,
  /\bhttp 5\d\d\b/i, // the provider's server failed, not this code
  /responses: transport failed/i,
]

/**
 * Whether a failure is worth a task: anything but a known transient.
 *
 * ```ts
 * import { actionable } from '@yaks/heal'
 *
 * actionable('fetch timed out') // false
 * actionable('no such table: bug') // true
 * ```
 */
export let actionable = (message: string): boolean =>
  !transient.some((re) => re.test(message))

/**
 * The priority a new bug is filed at: 1 where the message says something is
 * missing or broken outright, 2 otherwise.
 *
 * ```ts
 * import { severity } from '@yaks/heal'
 *
 * severity('exit 127: codex not found') // 1
 * severity('unexpected token') // 2
 * ```
 */
export let severity = (message: string): number =>
  /exit (?!0\b)\d|not found|127|cannot |failed to |unable to /i.test(message)
    ? 1
    : 2

let MARK = '\n\n— ↻ '

/**
 * A bug's body with its recurrence line brought up to date: replaced where it
 * has one, appended where it does not, so the body never grows with the storm.
 *
 * ```ts
 * import { recurred } from '@yaks/heal'
 *
 * recurred('it broke', 2, 'noon') // 'it broke\n\n— ↻ recurred 2× · last seen noon'
 * ```
 */
export let recurred = (body: string, hits: number, at: string): string => {
  let i = body.indexOf(MARK)
  return `${i < 0 ? body : body.slice(0, i)}${MARK}recurred ${hits}× · ` +
    `last seen ${at}`
}
