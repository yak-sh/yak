// What a failed build says, as lines an agent can act on: esbuild's own
// messages at the place they point, `file:line:column: message` and the line
// itself beneath, the way a compiler prints them. esbuild names a file by the
// namespace it loaded it from (`virtual:worker.ts`); the namespace is
// @cloudflare/worker-bundler's, not the app's, so it goes.

/** One esbuild message, the part of it read here. */
export type Message = {
  text: string
  location?: {
    file: string
    line: number
    column: number
    lineText?: string
  } | null
}

/** How many messages a refusal carries: the first ones are the cause, and the
 * rest are usually the same mistake again. */
export let SHOWN = 10

/** One message as the agent reads it; the column counts from 1, as an editor
 * does.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   line({ text: 'Unexpected "}"', location: { file: 'virtual:worker.ts',
 *     line: 2, column: 49, lineText: '  fetch: () => ok( }' } }),
 *   'worker.ts:2:50: Unexpected "}"\n    fetch: () => ok( }',
 * )
 * ```
 */
export let line = ({ text, location: at }: Message) =>
  at
    ? `${at.file.replace(/^[a-z-]+:/, '')}:${at.line}:${at.column + 1}: ` +
      text + (at.lineText ? `\n  ${at.lineText}` : '')
    : text

/** What a thrown build error says: esbuild's messages when it carries them,
 * else its own message. */
export let said = (e: unknown): string[] => {
  let errors = (e as { errors?: Message[] })?.errors
  if (Array.isArray(errors) && errors.length) {
    let shown = errors.slice(0, SHOWN).map(line)
    let more = errors.length - shown.length
    return more ? [...shown, `… and ${more} more`] : shown
  }
  return [e instanceof Error ? e.message : String(e)]
}
