import { type DocumentIO, type Draft, prepare } from './document.ts'
import { DocumentInputError } from './document-errors.ts'
import { products } from './layout.ts'

export type Door = {
  fetch(input: string, init?: RequestInit): Promise<Response>
}
export type Buyer = { person?: string; via?: string }
let answer = async (res: Response) => {
  if (!res.ok) {
    throw new Error(
      'Document platform door failed: ' + res.status + ' ' + await res.text(),
    )
  }
  return res
}

/** The app's vouched server door; customer identity comes from its worker's
 * request headers, after checking the source draft belongs to that customer. */
export let documents = (
  app: Door,
  source: Door,
  buyer: Buyer,
  font?: string,
  call: typeof fetch = fetch,
): DocumentIO => ({
  read: async (blob) => {
    let remote = URL.canParse(blob)
    if (remote && new URL(blob).protocol != 'https:') {
      throw new DocumentInputError('Source assets require HTTPS')
    }
    let response = remote
      ? await call(blob)
      : await (blob == font ? app : source).fetch(
        '/pay/artifacts/' + encodeURIComponent(blob),
      )
    if (
      blob != font && [400, 401, 403, 404, 410, 422].includes(response.status)
    ) {
      throw new DocumentInputError(
        'Source artwork is unavailable (' + response.status +
          '); upload it again or renew its access',
      )
    }
    let res = await answer(response)
    return new Uint8Array(await res.arrayBuffer())
  },
  put: async (bytes, mime) => {
    let params = new URLSearchParams()
    if (buyer.person) params.set('buyer', buyer.person)
    if (buyer.via) params.set('via', buyer.via)
    let res = await answer(
      await app.fetch('/pay/artifacts?' + params, {
        method: 'POST',
        headers: { 'content-type': mime, 'x-yak-name': 'Print document' },
        body: new Uint8Array(bytes),
      }),
    )
    let row = await res.json()
    if (typeof row.eid != 'string') {
      throw new Error('Document upload returned no blob identity')
    }
    return row.eid
  },
  preview: async (bytes, page) => {
    let res = await answer(
      await app.fetch('/pdf?page=' + page + '&render=1', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: new Uint8Array(bytes),
      }),
    )
    let row = await res.json()
    if (typeof row.image != 'string') {
      throw new Error('PDF page renderer returned no image')
    }
    return Uint8Array.from(atob(row.image), (c) => c.charCodeAt(0))
  },
})

export let preparation = (
  app: Door,
  source: Door,
  buyer: Buyer,
  product: string,
  draft: Draft,
  font?: string,
  call: typeof fetch = fetch,
) => {
  let spec = products[product]
  if (!spec) throw new DocumentInputError('Unknown print product: ' + product)
  return prepare(
    spec,
    { ...draft, font },
    documents(app, source, buyer, font, call),
  )
}
