// A binary apply as the store's write log keeps it is undecoded (@yaks/api/log
// `taken`): decoding needs the words a store's start reads. The store decodes
// it as it lands (graph.ts `#commit`). Only declared binary properties
// interpret payload references.
import type { Vocab } from '@yaks/vocab'
import { binaryHeaders } from '@yaks/api/log'
import { fromBase64 } from '@yaks/fp'
import { decode, unpack } from '@yaks/vocab/wire'

/** What a kept body says once its words are known: a binary one's envelope
 * decoded in them, as a JSON one's base64 values are.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 * import { binary, BINARY } from '@yaks/vocab/wire'
 * import { taken } from '@yaks/api/log'
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
