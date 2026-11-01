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
