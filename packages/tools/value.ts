// Reading an answer as data. A tool answers words for a person and, where a
// program has something to read, the same answer as data in `output{value}`
// beside them. This file is that one read, importing nothing that runs, so a
// client that only reads answers (the CLI talking to a server, a probe) takes
// it without the runner and the vocabulary behind it (`@yaks/tools/value`).
import type { Bundle, Comp } from '@yaks/graph'

/** An image answered beside a tool's text and structured value. */
export type Image = { data: string; mime_type: string }

/** Images a tool answered, for a door that displays them inline. */
export let imagesIn = (answer: Bundle[]): Image[] =>
  answer.flatMap((b) => {
    let images = (b.output as Comp | undefined)?.images
    return Array.isArray(images)
      ? images.filter((v): v is Image =>
        !!v && typeof v == 'object' && typeof v.data == 'string' &&
        typeof v.mime_type == 'string'
      )
      : []
  })

/**
 * A tool's answer that is a value: one bundle aimed at the call, carrying the
 * value once, in `output{value}`. A door that sends text says it as
 * {@link json}; one that sends data sends it as it is.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(valued({ entity: { eid: 'c1' } }, { n: 1 }), {
 *   entity: { eid: '$said' },
 *   output: { source: 'c1', value: { n: 1 } },
 * })
 * ```
 */
export let valued = (call: Bundle, value: unknown): Bundle => ({
  entity: { eid: '$said' },
  output: { source: call.entity.eid, value },
})

/**
 * A value as the text a door that sends text says: one line where it fits in
 * 80 characters, indented JSON where it does not.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(json({ count: 2 }), '{"count":2}')
 * assertEquals(json({ s: 'x'.repeat(80) }).split('\n').length, 3)
 * ```
 */
export let json = (value: unknown): string => {
  let line = JSON.stringify(value) ?? 'null'
  return line.length <= 80 ? line : JSON.stringify(value, null, 2)
}

/**
 * The `output{value}` an answer carries: the same answer as data, beside the
 * words a person reads. A caller that wants the answer's facts reads them here,
 * never out of the words, which may carry more than the answer.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let said = { entity: { eid: '$said' }, content: { body: 'a.txt' } }
 * let files = { files: [{ path: 'a.txt' }] }
 * assertEquals(valueIn([{ ...said, output: { value: files } }]), files)
 * assertEquals(valueIn([said]), undefined)
 * ```
 */
export let valueIn = (
  answer: Bundle[],
): Record<string, unknown> | undefined =>
  answer
    .map((b) => (b.output as Comp | undefined)?.value)
    .find((v): v is Record<string, unknown> => !!v && typeof v == 'object')
