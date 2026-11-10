// Normalize a raw binary apply request before the store's JSON write log and
// admission. Only declared binary properties interpret payload references.
import type { Vocab } from '@yaks/vocab'
import { fromBase64, toBase64 } from '@yaks/fp'
import { BINARY, decode, stringify, unpack } from '@yaks/vocab/wire'

/** Give the store's JSON admission the same values as its binary HTTP door. */
export let binaryRequest = async (
  request: Request,
  vocab: Vocab,
): Promise<Request> => {
  let packed = unpack(await request.arrayBuffer())
  let body = stringify(decode(vocab, packed.value, packed.payload))
  let headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  return new Request(request, { headers, body })
}

let binaryHeaders = (headers: Headers) =>
  headers.get('content-type')?.split(';')[0].trim() == BINARY

/** Whether this request uses the store's raw binary apply door. */
export let isBinaryApply = (request: Request): boolean =>
  binaryHeaders(request.headers) && new URL(request.url).pathname == '/apply'

/** A binary apply as the write log keeps it undecoded: the envelope as it
 * came, in base64 beside the headers that say it is binary, and its bundles
 * as the envelope's header says them, references and all. Decoding needs the
 * words a store's start reads, so a store that may not start yet keeps the
 * envelope (graph.ts `#sealed`), and it is decoded as it lands (`opened`,
 * then `binaryRequest`). An envelope that can't be read is refused here,
 * while its caller still holds it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { binary, BINARY } from '@yaks/vocab/wire'
 * let raw = binary([{ entity: { eid: 'a' }, photo: { bytes: Uint8Array.of(7) } }])
 * let { body, header } = sealed(raw)
 * equal(header, '[{"entity":{"eid":"a"},"photo":{"bytes":{"$bytes":0,"length":1}}}]')
 * equal(opened(new Headers({ 'content-type': BINARY }), body), raw)
 * equal(opened(new Headers(), '[]'), '[]')
 * ```
 */
export let sealed = (raw: Uint8Array): { body: string; header: string } => ({
  header: JSON.stringify(unpack(raw).value),
  body: toBase64(raw),
})

/** A kept body as it was sent: the envelope of a binary one (`sealed`), the
 * text of any other. */
export let opened = (
  headers: Headers,
  body: string,
): string | Uint8Array<ArrayBuffer> =>
  binaryHeaders(headers) ? fromBase64(body) : body
