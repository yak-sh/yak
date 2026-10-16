// Normalize a raw binary apply request before the store's JSON write log and
// admission. Only declared binary properties interpret payload references.
import type { Vocab } from '@yaks/vocab'
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

/** Whether this request uses the store's raw binary apply door. */
export let isBinaryApply = (request: Request): boolean =>
  request.headers.get('content-type')?.split(';')[0].trim() == BINARY &&
  new URL(request.url).pathname == '/apply'
