// Fault grouping, independent of storage and the reporter.

import type { Bundle } from '@yaks/graph'
import { comp, str, title } from './model.ts'

/**
 * A message with its volatile parts replaced by `#`.
 *
 * ```ts
 * import { normalize } from '@yaks/tracker'
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
 * import { faultKey } from '@yaks/tracker'
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

/** Reporting and grouping use the same explicit or derived fault. */
export let faultOf = (row: Bundle): string =>
  str(comp(row, 'error').fault) || faultKey(
    str(comp(row, 'during').kind),
    title(row),
    str(comp(row, 'exception').stack),
  )
