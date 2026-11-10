// A binary apply as the store's write log keeps it: undecoded. Decoding needs
// the words a store's start reads, and a write is kept before its store has
// started, while it may not (graph.ts `#ceiling`) and when it can't (a schema
// that refused), so the log holds the envelope as it came and the store
// decodes it as it lands (graph.ts `#commit`). Only declared binary
// properties interpret payload references.
import type { Vocab } from '@yaks/vocab'
import { readBody } from '@yaks/api'
import { fromBase64, toBase64 } from '@yaks/fp'
import { BINARY, decode, unpack } from '@yaks/vocab/wire'

let binaryHeaders = (headers: Headers) =>
  headers.get('content-type')?.split(';')[0].trim() == BINARY

/** Whether this request uses the store's raw binary apply door. */
export let isBinaryApply = (request: Request): boolean =>
  binaryHeaders(request.headers) && new URL(request.url).pathname == '/apply'

/** A write's body as the log keeps it, and its bundles as it says them before
 * any decoding, which is what a secret is looked for in (writes.ts `keyed`).
 * A JSON body is its text, both times; a binary one is its envelope in base64
 * beside the headers that say it is binary, and the envelope's header with
 * its references. An envelope that can't be read is refused here, while its
 * caller still holds it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { binary, BINARY } from '@yaks/vocab/wire'
 * let raw = binary([{ entity: { eid: 'a' }, photo: { bytes: Uint8Array.of(7) } }])
 * let sent = (body: BodyInit, type = BINARY) =>
 *   new Request('http://store/apply', { method: 'POST', headers: { 'content-type': type }, body })
 * let { body, told } = await taken(sent(raw))
 * equal(told, '[{"entity":{"eid":"a"},"photo":{"bytes":{"$bytes":0,"length":1}}}]')
 * equal(opened(new Headers({ 'content-type': BINARY }), body), raw)
 * equal(await taken(sent('[]', 'application/json')), { body: '[]', told: '[]' })
 * equal(opened(new Headers(), '[]'), '[]')
 * ```
 */
export let taken = async (
  request: Request,
): Promise<{ body: string; told: string }> => {
  if (!isBinaryApply(request)) {
    let body = await readBody(request)
    return { body, told: body }
  }
  let raw = new Uint8Array(await request.arrayBuffer())
  return { body: toBase64(raw), told: JSON.stringify(unpack(raw).value) }
}

/** A kept body as it was sent: the envelope of a binary one (`taken`), the
 * text of any other. */
export let opened = (
  headers: Headers,
  body: string,
): string | Uint8Array<ArrayBuffer> =>
  binaryHeaders(headers) ? fromBase64(body) : body

/** What a kept body says once its words are known: a binary one's envelope
 * decoded in them, as a JSON one's base64 values are.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 * import { binary, BINARY } from '@yaks/vocab/wire'
 * import { appKeywords } from './vocab.ts'
 * let vocab = loadVocab({ $defs: { photo: { component: true, type: 'object',
 *   properties: { bytes: { type: 'string', contentEncoding: 'base64' } } } } },
 *   appKeywords)
 * let bundle = { entity: { eid: 'a' }, photo: { bytes: Uint8Array.of(7) } }
 * let { body } = await taken(new Request('http://store/apply', {
 *   method: 'POST', headers: { 'content-type': BINARY }, body: binary([bundle]),
 * }))
 * equal(decoded(vocab, new Headers({ 'content-type': BINARY }), body), [bundle])
 * equal(decoded(vocab, new Headers(), '[{"photo":{"bytes":{"$bytes":"Bw==","encoding":"base64"}}}]'),
 *   [{ photo: { bytes: Uint8Array.of(7) } }])
 * ```
 */
export let decoded = (
  vocab: Pick<Vocab, 'def'>,
  headers: Headers,
  body: string,
): unknown => {
  if (!binaryHeaders(headers)) return decode(vocab, JSON.parse(body))
  let packed = unpack(fromBase64(body))
  return decode(vocab, packed.value, packed.payload)
}
