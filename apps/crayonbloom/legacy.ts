// Existing printable, receipt and unsubscribe URLs keep their scoped reach.
// The wrapper verifies legacy signed sessions/cookies at its authentication
// boundary and passes only the resolved principal; source secrets stay there.
import { type Bundle, sha256 } from '@yaks/graph'
import type { Rails } from './rails.ts'

export type LegacyPrincipal = { owner?: string; via?: string }
export type LegacyStore = {
  query: (q: string) => Promise<Bundle[]>
  apply: (rows: Bundle[]) => Promise<unknown>
}
type LegacyRow = Bundle & {
  legacy_record?: { snapshot: Record<string, unknown> }
  legacy_asset?: {
    role: string
    blob: string
    mime: string
    source_blob?: string
  }
  print_receipt?: { receipt: Record<string, unknown> }
}
export type LegacyPorts = {
  credentials?: Rails
  asset?: (blob: string) => Promise<Response>
  printable?: (
    artwork: { blob: string; mime: string },
    title: string,
  ) => Promise<Response>
  bind?: (
    claim: { kind: 'user' | 'guest'; id: string },
    caller: LegacyPrincipal,
  ) => Promise<LegacyPrincipal>
}

/** A source signature and a vouched platform principal are both required by
 * the binding boundary. A client-supplied email never participates. */
export let legacyIdentity = async (
  request: Request,
  caller: LegacyPrincipal,
  ports: LegacyPorts,
  now: string,
): Promise<LegacyPrincipal> => {
  if (!ports.credentials || !ports.bind) return caller
  let claims = await ports.credentials.identity(request, now)
  if ((!caller.owner && !caller.via) || (!claims.user && !claims.guest)) {
    return caller
  }
  return ports.bind(
    claims.user
      ? { kind: 'user', id: claims.user }
      : { kind: 'guest', id: claims.guest! },
    caller,
  )
}
let records = async (db: LegacyStore, q: string): Promise<LegacyRow[]> =>
  await db.query(q) as LegacyRow[]
let artifact = async (ports: LegacyPorts, blob: string): Promise<Response> => {
  if (!ports.asset) {
    throw Error('The legacy asset read boundary is unavailable')
  }
  let response = await ports.asset(blob)
  if (!response.ok) {
    throw Error(`Imported asset read failed (${response.status})`)
  }
  let headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store, private')
  return new Response(response.body, { status: response.status, headers })
}
let json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store, private' },
  })
let missing = () => json({ error: 'This link is not available.' }, 404)
let wantsJson = (request: Request) =>
  !!request.headers.get('accept')?.includes('application/json')
let escape = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** The path the visitor addressed before the app's mount was stripped. */
let base = (request: Request): string => {
  let address = new URL(request.headers.get('x-yak-address') ?? request.url)
      .pathname,
    path = new URL(request.url).pathname
  return address.endsWith(path) ? address.slice(0, -path.length) : ''
}
/** The public pages' chrome, so an old link lands on a CrayonBloom page. */
let html = (request: Request, title: string, body: string): Response => {
  let root = base(request)
  let link = (href: string, text: string) =>
    `<a class="Public_Link" href="${root}${href}">${text}</a>`
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — CrayonBloom</title><link rel="stylesheet" href="${root}/public.css"></head><body class="Public Public-crayonbloom"><a class="Public_Skip" href="#main">Skip to content</a><header class="Public_Header"><a class="Public_Brand" href="${root}/">CrayonBloom</a><nav class="Public_Nav" aria-label="Main navigation">${
      link('/studio', 'Your books')
    } ${link('/coloring-pages', 'Coloring pages')} ${
      link('/faq', 'Questions')
    }</nav></header><main class="Public_Main" id="main"><article class="Public_Body">${body}</article></main><footer class="Public_Footer">${
      link('/privacy', 'Privacy')
    } ${link('/terms', 'Terms')} ${
      link('/contact', 'Contact')
    }<p class="Public_Paragraph">CrayonBloom · Yak Shaving LLC</p></footer></body></html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, private',
      },
    },
  )
}
let optOut = (request: Request, unsubscribed: boolean): Response => {
  if (wantsJson(request)) return json({ unsubscribed })
  let body = unsubscribed
    ? '<p class="Public_Paragraph">You are unsubscribed from commercial messages.</p>'
    : '<p class="Public_Paragraph">You can stop commercial messages from CrayonBloom.</p><form method="post"><button>Unsubscribe</button></form>'
  return html(
    request,
    'Unsubscribe',
    `<h1 class="Public_Title">Unsubscribe</h1>${body}`,
  )
}
type Art = { blob: string; mime: string }
/** The Rails free-page result: the finished page, or the failed draw. */
let freePage = (
  request: Request,
  token: string,
  prompt: unknown,
  art?: Art,
): Response => {
  let root = base(request),
    here = `${root}/free_pages/${encodeURIComponent(token)}`
  let more =
    `<p class="Public_Paragraph"><a class="Public_Link" href="${root}/coloring-pages">`
  if (!art) {
    return html(
      request,
      'A coloring page',
      `<h1 class="Public_Title">That one didn’t come out right.</h1><p class="Public_Paragraph">Our crayons slipped on this one. Here’s a shelf of pages that are ready to print right now.</p>${more}Browse coloring pages</a></p>`,
    )
  }
  let idea = escape(prompt)
  return html(
    request,
    `“${escape(String(prompt ?? '').slice(0, 70))}”`,
    `<p class="Public_Subheading">Ready to color</p><h1 class="Public_Title">Your page is ready!</h1><p class="Public_Paragraph">“${idea}”</p><p class="Public_Paragraph"><img class="Public_Image" src="${here}/artwork" alt="Coloring page for ${idea}"></p><p class="Public_Paragraph"><a class="Public_Link" href="${here}/download">Download printable PDF</a></p><p class="Public_Paragraph"><a class="Public_Link" href="${here}/artwork" download>Download image${
      art.mime === 'image/png' ? ' (PNG)' : ''
    }</a></p>${more}More pages to print</a></p><p class="Public_Paragraph">The printable has a blank line at the bottom — your kid can sign it in crayon when the coloring is done.</p>`,
  )
}
let decoded = (value: string): string | null => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
let valid = (value?: string): boolean =>
  !!value && /^[a-f0-9-]{36}$/i.test(value)
let principal = (who: LegacyPrincipal): string[] => [
  ...(valid(who.owner) ? [`.legacy_record.owner=${who.owner}`] : []),
  ...(valid(who.via)
    ? [`.legacy_record.via=${who.via}&!legacy_record.owner`]
    : []),
]

/** This reads only source history; it cannot submit, charge or regenerate. */
export let legacyPage = async (
  request: Request,
  db: LegacyStore,
  who: LegacyPrincipal,
  now = new Date().toISOString(),
  ports: LegacyPorts = {},
): Promise<Response | null> => {
  let path = new URL(request.url).pathname
  let blob = path.match(
    /^\/rails\/active_storage\/blobs\/(?:redirect|proxy)\/([^/]+)\/[^/]+$/,
  )
  if (blob && request.method === 'GET') {
    let value = decoded(blob[1])
    let id = value && ports.credentials
      ? await ports.credentials.blob(value, now)
      : undefined
    if (!id) return missing()
    let [asset] = await records(db, `.legacy_asset.source_blob=${id}`)
    if (!asset?.legacy_asset) return missing()
    return artifact(ports, asset.legacy_asset.blob)
  }
  let page = path.match(/^\/free_pages\/([^/]+)(?:\/(artwork|download))?$/)
  if (page && request.method === 'GET') {
    let token = decoded(page[1])
    if (!token) return missing()
    let [row] = await records(
      db,
      `.legacy_page.digest=${sha256(token)}&?legacy_record`,
    )
    if (!row) return missing()
    let snapshot = row.legacy_record?.snapshot ?? {}
    let artwork = (await records(db, `.legacy_asset.record=${row.entity.eid}`))
      .find((r) => r.legacy_asset?.role === 'artwork')?.legacy_asset
    // Rails' gate: the art shows once drawn and claimed with an email.
    let art = snapshot.status === 'completed' && snapshot.email
      ? artwork
      : undefined
    if (page[2] === 'artwork') {
      return art ? artifact(ports, art.blob) : missing()
    }
    if (page[2] === 'download') {
      if (!art || !ports.printable) return missing()
      return ports.printable(art, String(snapshot.prompt ?? ''))
    }
    if (wantsJson(request)) {
      return json({
        prompt: snapshot.prompt,
        status: snapshot.status,
        artwork: art ? [art] : [],
      })
    }
    return freePage(request, token, snapshot.prompt, art)
  }
  let order = path.match(/^\/orders\/(\d+)$/)
  if (order && request.method === 'GET') {
    let access = principal(who)
    if (!access.length) return missing()
    let rows = (await Promise.all(access.map((filter) =>
      records(db, `.legacy_record.table=orders&${filter}&?print_receipt`)
    ))).flat()
    let row = rows.find((r) =>
      String(r.legacy_record?.snapshot.id) === order[1]
    )
    let receipt = row?.print_receipt?.receipt
    if (!receipt?.historical) {
      return missing()
    }
    return json({
      id: receipt.id,
      title: receipt.title,
      status: receipt.status,
      tracking: receipt.tracking ?? null,
    })
  }
  let unsubscribe = path.match(/^\/unsubscribe\/([^/]+)$/)
  if (unsubscribe && ['GET', 'POST'].includes(request.method)) {
    let token = decoded(unsubscribe[1])
    if (!token) return missing()
    let [row] = await db.query(
      `.legacy_opt_out.digest=${sha256(token)}&?mail_opt_out`,
    )
    if (!row) return missing()
    if (request.method === 'POST' && !row.mail_opt_out) {
      await db.apply([{ entity: row.entity, mail_opt_out: { at: now } }])
    }
    return optOut(request, request.method === 'POST' || !!row.mail_opt_out)
  }
  return null
}
