// The customer door returns one checked receipt or artifact. The seller's
// graph remains behind its existing editor authority.
import type { Bundle, Comp } from '@yaks/graph'
import type { Answer, Asked } from './apps.ts'
import { appStore } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { blobPrefix } from './blob-key.ts'
import { blobBytes } from './files.ts'
import { Untaken, uploaded, useOf } from './uploads.ts'
import { quoteDoor } from './sell.ts'
import {
  ARTIFACT_LIFE,
  artifactPermit,
  artifactTicket,
  mayReceive,
  protectedArtifact,
  type SaleAccess,
} from './sale-private.ts'

let privateJson = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'private, no-store' },
  })
let missing = () => privateJson({ error: { code: 'not_found' } }, 404)
let editor = ({ who }: Asked) =>
  who.role == 'owner' || String(who.role) == 'editor'
let storeOf = ({ env, space, app }: Asked) =>
  metaOf(appStore(env.STORE, space, app, env), {
    ...KERNEL,
    'x-yak-person': app.eid,
    'x-yak-role': 'editor',
  })
let accessOf = (row: Bundle) => row.sale_access as SaleAccess | undefined
let allowed = (at: Asked, row: Bundle) =>
  editor(at) || !!accessOf(row) && mayReceive(accessOf(row)!, {
      person: at.who.service?.person ?? at.who.person,
      via: at.who.via,
    })
let artifactRows = (rows: Bundle[], sha: string, bytes: number) => {
  let attachment = rows.find((row) => row.attachment)!.attachment as Comp
  return rows.map((row) =>
    row.entity.eid == sha
      ? {
        ...row,
        artifact: { address: sha, media_type: attachment.mime, size: bytes },
      }
      : row
  )
}

/** Provider payment identifiers stay on the seller's graph. */
export let customerReceipt = (row: Bundle) => {
  let order = row.order as Comp
  let fields = [
    'items',
    'total_cents',
    'status',
    'quote',
    'document',
    'revision',
    'specification',
    'quantity',
    'currency',
    'destination',
    'shipping',
    'shipping_cents',
    'tax_cents',
  ]
  return {
    entity: { eid: row.entity.eid },
    doc: { title: (row.doc as Comp | undefined)?.title },
    order: Object.fromEntries(
      fields.filter((k) => order[k] != null)
        .map((k) => [k, order[k]]),
    ),
  }
}

let orders = async (at: Asked, id: string) => {
  if (at.req.method != 'GET') return at.json(405, 'method_not_allowed')
  let graph = storeOf(at)
  let rows = await graph.query(
    `(.entity.eid=${id} .order|.order.quote=${id}) ?sale_access ?doc`,
  )
  let row = rows.find((row) => row.order && allowed(at, row))
  return row ? privateJson(customerReceipt(row)) : missing()
}

let upload = async (at: Asked) => {
  if (at.req.method != 'POST') return at.json(405, 'method_not_allowed')
  if (!editor(at)) return at.json(403, 'not_an_editor')
  let url = new URL(at.req.url)
  let buyer = url.searchParams.get('buyer')
  let via = url.searchParams.get('via')
  if (!buyer && !via) return at.json(400, 'missing_customer')
  let bytes = new Uint8Array(await at.req.arrayBuffer())
  if (!bytes.byteLength) return at.json(400, 'no_bytes')
  let name = at.req.headers.get('x-yak-name') ?? ''
  try {
    name = decodeURIComponent(name)
  } catch { /* Keep the sent name. */ }
  let file = await uploaded(
    at.env,
    at.space,
    at.app,
    storeOf(at),
    bytes,
    {
      mime: at.req.headers.get('content-type') ?? 'application/octet-stream',
      name,
      protect: (rows, sha) =>
        protectedArtifact(
          artifactRows(rows, sha, bytes.byteLength),
          sha,
          { buyer, via },
        ),
    },
  )
  return privateJson({
    eid: file.sha,
    attachment: file.use,
    url: `/${at.app.slug}/api/pay/artifacts/${file.sha}`,
    mime: file.mime,
    bytes: bytes.byteLength,
    ...file.size,
  })
}

let entitled = async (at: Asked, sha: string) => {
  let rows = await storeOf(at).query(
    `.sale_artifact.artifact=${sha} ?sale_access`,
  )
  return rows.some((row) => allowed(at, row))
}

let artifacts = async (at: Asked, sha: string, link: boolean) => {
  let { req, env, app, space } = at
  let token = new URL(req.url).searchParams.get('ticket')
  let signed = !link && !!token && !!env.SESSION_SECRET &&
    await artifactPermit(token, app.eid, sha, env.SESSION_SECRET)
  if (!signed && !await entitled(at, sha)) return missing()
  if (link) {
    if (req.method != 'POST') return at.json(405, 'method_not_allowed')
    if (!env.SESSION_SECRET) return at.json(503, 'signing_unavailable')
    let now = Date.now()
    let url = new URL(req.url)
    url.pathname = url.pathname.slice(0, -'/link'.length)
    url.search = ''
    url.searchParams.set(
      'ticket',
      await artifactTicket(app.eid, sha, env.SESSION_SECRET, now),
    )
    return privateJson({ url: url.href, expires: now + ARTIFACT_LIFE })
  }
  if (req.method != 'GET' && req.method != 'HEAD') {
    return at.json(405, 'method_not_allowed')
  }
  // A signed URL never revives bytes whose entitlement has been removed.
  if (
    signed &&
    !(await storeOf(at).query(`.sale_artifact.artifact=${sha}`)).length
  ) {
    return missing()
  }
  let [file] = await storeOf(at).query(`.entity.eid=${await useOf(sha)}`)
  if (!file?.attachment) return missing()
  let body = await blobBytes(
    env,
    app,
    blobPrefix(space, app),
    sha,
    req.headers.get('range'),
    req.method,
  )
  if (!body.ok) return body
  let headers = new Headers(body.headers)
  headers.set('content-type', String((file.attachment as Comp).mime))
  headers.set('cache-control', 'private, no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(body.body, { status: body.status, headers })
}

export let saleDoor: Answer = async (at) => {
  let quote = /^\/pay\/quotes(?:\/([0-9a-f-]{36,64}))?$/.exec(at.path)
  if (quote) {
    return editor(at)
      ? quoteDoor(at.req, at.env, { space: at.space, app: at.app }, quote[1])
      : at.json(403, 'not_an_editor')
  }
  if (at.path == '/pay/artifacts') {
    try {
      return await upload(at)
    } catch (e) {
      if (e instanceof Untaken) return at.json(e.status, e.code, e.message)
      throw e
    }
  }
  let order = /^\/pay\/orders\/([0-9a-f-]{36,64})$/.exec(at.path)
  if (order) return orders(at, order[1])
  let artifact = /^\/pay\/artifacts\/([0-9a-f]{64})(\/link)?$/.exec(at.path)
  return artifact ? artifacts(at, artifact[1], !!artifact[2]) : null
}
