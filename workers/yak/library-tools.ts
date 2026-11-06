// An app's library (public/docs/library.md): the documents uploaded into its
// store, whose text is extracted into `document_page` rows that search and
// `./api/documents/ask` read. These tools add a document from a web address,
// from what the person attached in a conversation with their Operator, or from
// bytes sent along; list the library with each document's extraction; read a
// document's text; and remove one. Every upload is the caller's own, through
// the same write `POST ./api/blob` makes (uploads.ts `uploaded`), so the app's
// `blob` floor and limits hold and extraction runs as it does for a page's.
import { mimeOf } from '@yaks/blob'
import type { Bundle, Comp } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import type { App, Space } from './directory.ts'
import { DOCUMENTS, supported } from './documents.ts'
import { metaOf } from './meta.ts'
import { allowed, uncopyable } from './robots.ts'
import { vouched, type Who } from './session.ts'
import {
  APP,
  type Args,
  byCaller,
  bytesOf,
  type Ctx,
  inApp,
  refuse,
  rejected,
  type Row,
  SPACE,
  str,
  text,
} from './tool.ts'
import { acceptsOf, belowFloor, Untaken, uploaded } from './uploads.ts'

// What the library sends as itself, and the token a robots.txt group names
// it by.
export let AGENT = 'yaks.app-library/1.0 (+https://yaks.app/docs/library)'
let TOKEN = 'yaks.app'
// The most one document may be: what a page sends in one request
// (public/client.js sends larger files in parts), or less where the app says.
let WHOLE = 32 * 1024 * 1024
// How many documents one call adds, and how many it fetches at once.
let MANY = 20
let AT_ONCE = 4
// How much text one library_read answers.
let READ = 60_000

// The extension a document's name needs to be read as one, by its type, for a
// name the address gave without one (`/download?id=7`).
let EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/markdown': 'md',
}

/** A document that was not added, and why: the site's no, or the app's. */
class Skipped extends Error {}

type Got = { bytes: Uint8Array<ArrayBuffer>; mime: string; name: string }

// --- from the web -----------------------------------------------------------

/** The body, unless it is bigger than `most`: read as it arrives, so a large
 * one is never held whole. */
let capped = async (r: Response, most: number) => {
  let said = Number(r.headers.get('content-length') ?? NaN)
  if (said > most || !r.body) {
    await r.body?.cancel()
    return said > most ? null : new Uint8Array(0)
  }
  let chunks: Uint8Array[] = [], total = 0
  let reader = r.body.getReader()
  for (;;) {
    let { done, value } = await reader.read()
    if (done || !value) break
    total += value.byteLength
    if (total > most) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  let out = new Uint8Array(total)
  let at = 0
  for (let c of chunks) out.set(c, (at += c.byteLength) - c.byteLength)
  return out
}

let megabytes = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

// The file's own name: what the site said to save it as, else the address's
// last segment, else its host.
let nameOf = (r: Response, at: URL) => {
  let said = r.headers.get('content-disposition') ?? ''
  let star = said.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1]
  let plain = said.match(/filename="?([^";]+)"?/i)?.[1]
  let last = at.pathname.split('/').filter(Boolean).at(-1)
  let name = star ?? plain ?? last ?? at.host
  try {
    name = decodeURIComponent(name)
  } catch { /* kept as sent */ }
  return name.trim().slice(0, 200)
}

type Rewriter = {
  on(
    selector: string,
    handlers: {
      element?(
        e: { remove(): void; getAttribute(n: string): string | null },
      ): void
      text?(t: { text: string }): void
    },
  ): Rewriter
  transform(res: Response): Response
}
declare let HTMLRewriter: { new (): Rewriter }

/** A web page as its article alone (scripts, styles, menus, headers, footers,
 * sidebars and forms removed), its title, and whether it asks not to be kept
 * (`<meta name="robots" content="noarchive">`). */
export let article = async (html: Uint8Array<ArrayBuffer>, mime: string) => {
  let title = '', og = '', robots = ''
  let bytes = new Uint8Array(
    await new HTMLRewriter()
      .on(
        'script, style, noscript, nav, header, footer, aside, form, iframe',
        { element: (e) => e.remove() },
      )
      .on('meta[property="og:title"]', {
        element: (e) => void (og = e.getAttribute('content') ?? ''),
      })
      .on('meta[name="robots"]', {
        element: (e) =>
          void (robots += ' ' + (e.getAttribute('content') ?? '')),
      })
      .on('title', { text: (t) => void (title += t.text) })
      .transform(new Response(html, { headers: { 'content-type': mime } }))
      .arrayBuffer(),
  )
  return { bytes, title: (og || title).replace(/\s+/g, ' ').trim(), robots }
}

/** What a site lets the library read, by its robots.txt: a site with none
 * lets it read everything, and one whose robots.txt could not be read (a 5xx,
 * no answer) lets it read nothing, as RFC 9309 says. */
let robotsOf = (send: typeof fetch) => {
  let held = new Map<string, Promise<string | null>>()
  return (at: URL) => {
    let got = held.get(at.origin) ??
      send(new URL('/robots.txt', at), { headers: { 'user-agent': AGENT } })
        .then(async (r) =>
          r.ok
            ? await r.text()
            : r.status < 500
            ? (await r.body?.cancel(), '')
            : null
        )
        .catch(() => null)
    held.set(at.origin, got)
    return got.then((txt) =>
      txt != null && allowed(txt, TOKEN, at.pathname + at.search)
    )
  }
}

/** A document off the web, or why the library skips it. */
export let fromWeb = async (
  said: string,
  most: number,
  mayRead: (at: URL) => Promise<boolean>,
  send: typeof fetch = fetch,
): Promise<Got> => {
  let at: URL
  try {
    at = new URL(said)
  } catch {
    throw new Skipped('not a web address')
  }
  if (at.protocol != 'https:' && at.protocol != 'http:') {
    throw new Skipped('not a web address')
  }
  if (!await mayRead(at)) {
    throw new Skipped("the site's robots.txt does not let yaks.app read it")
  }
  let r: Response
  try {
    r = await send(at, {
      headers: {
        'user-agent': AGENT,
        accept:
          'application/pdf, text/html;q=0.9, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain;q=0.8, */*;q=0.5',
      },
    })
  } catch (e) {
    throw new Skipped(
      `the site could not be reached (${(e as Error).message ?? e})`,
    )
  }
  if (!r.ok) {
    await r.body?.cancel()
    throw new Skipped(`the site answered ${r.status}, so it was not read`)
  }
  let tag = r.headers.get('x-robots-tag')
  if (uncopyable(tag)) {
    await r.body?.cancel()
    throw new Skipped(
      `the site asks that it not be copied (X-Robots-Tag: ${tag})`,
    )
  }
  let bytes = await capped(r, most)
  if (!bytes) throw new Skipped(`it is bigger than ${megabytes(most)}`)
  if (!bytes.byteLength) throw new Skipped('the site sent nothing')
  let mime = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    .toLowerCase()
  let name = nameOf(r, new URL(r.url || at))
  if (!mime || mime == 'application/octet-stream') mime = mimeOf(name)
  if (mime == 'text/html' || mime == 'application/xhtml+xml') {
    let page = await article(bytes, 'text/html')
    if (uncopyable(page.robots)) {
      throw new Skipped(
        `the page asks that it not be copied (robots: ${page.robots.trim()})`,
      )
    }
    // The words a reader sees: the body's, not the title in its head.
    let body = new TextDecoder().decode(page.bytes)
      .replace(/<head[\s\S]*?<\/head>/i, '').replace(/<[^>]*>/g, '')
    if (!/\S/.test(body)) {
      throw new Skipped(
        'the page has no text without its scripts, which the library does not run',
      )
    }
    return { bytes: page.bytes, mime: 'text/html', name: page.title || name }
  }
  return named({ bytes, mime, name })
}

// A document's name, given the extension it is read by where it has none;
// anything the library does not read is skipped.
let named = (got: Got): Got => {
  let ext = EXTENSIONS[got.mime]
  let name = ext && !new RegExp(`\\.${ext}$`, 'i').test(got.name)
    ? `${got.name || 'document'}.${ext}`
    : got.name
  if (!supported(name, got.mime)) {
    throw new Skipped(
      `it is ${got.mime || 'of no known type'}, and the library reads ${
        DOCUMENTS.join(', ')
      } files`,
    )
  }
  return { ...got, name }
}

// --- what the call names ----------------------------------------------------

type Asked = {
  url?: unknown
  attachment?: unknown
  base64?: unknown
  name?: unknown
  replaces?: unknown
}

// Where the document named as `asked` is said from, for its line.
let labelOf = (asked: Asked) =>
  String(asked.url ?? asked.name ?? asked.attachment ?? 'document')

/** The bytes of a file the person attached in a conversation with their
 * Operator (operator-channels.ts `keepFile`), which it reads as
 * `attachment <sha>`. */
let fromChat = async (ctx: Ctx, space: Space, sha: string, name: string) => {
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw refuse('arguments', `attachment: ${sha} is not an attachment id`)
  }
  let kept = await ctx.env.BLOBS.get(`${space.store}/.operator/${sha}`)
  if (!kept) throw new Skipped('no such attachment in this space')
  let bytes = new Uint8Array(await kept.arrayBuffer())
  return named({ bytes, mime: mimeOf(name), name })
}

let documentsOf = (args: Args): Asked[] => {
  let list = args.documents == null
    ? [{
      url: args.url,
      attachment: args.attachment,
      base64: args.base64,
      name: args.name,
      replaces: args.replaces,
    }]
    : args.documents
  if (!Array.isArray(list) || !list.length) {
    throw refuse('arguments', 'documents: one or more documents to add')
  }
  if (list.length > MANY) {
    throw refuse(
      'arguments',
      `documents: at most ${MANY} in one call, not ${list.length}`,
    )
  }
  list.forEach((d: Asked, i) => {
    let from = [d.url, d.attachment, d.base64].filter((v) => v != null)
    if (from.length != 1) {
      throw refuse(
        'arguments',
        `documents[${i}]: one of url, attachment or base64`,
      )
    }
    if (d.url == null && typeof d.name != 'string') {
      throw refuse('arguments', `documents[${i}]: name, the file's name`)
    }
  })
  return list
}

// A document's rows: the file, and its extraction or why it failed.
let SHELF = '.attachment&?document_text&?failed'

// The library's rows as the caller reads them.
let shelf = (store: Parameters<typeof metaOf>[0], who: Who) =>
  metaOf(store, vouched(who))

// Every result of `each` over `list`, `n` at a time, in order.
let pooled = async <T, R>(list: T[], n: number, each: (t: T) => Promise<R>) => {
  let out: R[] = new Array(list.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (next < list.length) {
        let i = next++
        out[i] = await each(list[i])
      }
    }),
  )
  return out
}

/** A document's removal: its content row, which takes its bytes, its
 * attachment and its extracted pages with it (facets/app-vocab.ts). */
let removal = (row: Bundle): Bundle[] => {
  let blob = (row.attachment as Comp | undefined)?.blob
  return [
    { entity: { eid: row.entity.eid }, $delete: true },
    ...blob ? [{ entity: { eid: String(blob) }, $delete: true }] : [],
  ]
}

let attachmentsAt = async (
  graph: ReturnType<typeof metaOf>,
  eids: string[],
) => {
  let rows = eids.length
    ? await graph.query(`${SHELF}&.entity.eid=${eids.join(',')}`)
    : []
  let found = new Map(rows.map((r) => [r.entity.eid, r]))
  let missing = eids.filter((e) => !found.has(e))
  if (missing.length) {
    throw refuse('missing', `no document ${missing.join(', ')} in the library`)
  }
  return eids.map((e) => found.get(e)!)
}

// A store's no (a 4xx it answered) as the call's refusal; anything else is
// ours, and thrown on to be reported.
let refusal = (e: unknown) => {
  let status = (e as { status?: number }).status
  return status && status < 500 && !(e instanceof CallError)
    ? rejected(status, (e as Error).message)
    : e
}

// A refusal of the call itself: the caller may not upload or delete here.
let access = (e: unknown) => e instanceof CallError && e.code == 'access'

// What a document reads as in a list: its state, from its rows.
let stateOf = (row: Bundle) => {
  let pages = (row.document_text as Comp | undefined)?.pages
  let failed = (row.failed as Comp | undefined)?.reason
  return failed
    ? { state: 'failed', reason: String(failed) }
    : pages != null
    ? { state: 'searchable', pages: Number(pages) }
    : { state: 'reading' }
}

let added = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  store: Parameters<typeof metaOf>[0],
  list: Asked[],
) => {
  let denied = await belowFloor(ctx.env, space, app, who)
  if (denied) throw refuse('access', denied.message)
  let accepts = await acceptsOf(ctx.env, space, app)
  let most = Math.min(accepts?.maxLength ?? WHOLE, WHOLE)
  let graph = metaOf(store, await byCaller(ctx, who))
  let mayRead = robotsOf(fetch)
  return await pooled(list, AT_ONCE, async (asked) => {
    let label = labelOf(asked)
    try {
      // What it replaces is found first, so a wrong eid adds nothing.
      let [old] = typeof asked.replaces == 'string'
        ? await attachmentsAt(graph, [asked.replaces])
        : []
      let got = asked.url != null
        ? await fromWeb(text(asked.url, 'url'), most, mayRead)
        : asked.attachment != null
        ? await fromChat(
          ctx,
          space,
          text(asked.attachment, 'attachment'),
          text(asked.name, 'name'),
        )
        : named({
          bytes: bytesOf(asked as Record<string, unknown>),
          mime: mimeOf(String(asked.name)),
          name: String(asked.name),
        })
      if (typeof asked.name == 'string' && asked.name && asked.url != null) {
        got = { ...got, name: asked.name }
      }
      if (got.bytes.byteLength > most) {
        throw new Skipped(`it is bigger than ${megabytes(most)}`)
      }
      let file = await uploaded(ctx.env, space, app, graph, got.bytes, {
        mime: got.mime,
        name: got.name,
        accepts,
        ...asked.url != null ? { source: String(asked.url) } : {},
      })
      let replaced = old && old.entity.eid != file.use
        ? old.entity.eid
        : undefined
      if (replaced) await graph.apply(removal(old))
      return {
        ok: true as const,
        label,
        eid: file.use,
        name: got.name,
        url: file.url,
        ...replaced ? { replaced } : {},
      }
    } catch (thrown) {
      let e = refusal(thrown)
      if (access(e)) throw e
      if (
        e instanceof Skipped || e instanceof Untaken ||
        e instanceof CallError
      ) return { ok: false as const, label, reason: e.message }
      throw e
    }
  })
}

let line = (s: string) => s.replace(/\s+/g, ' ').trim()

export let libraryTools: Row[] = [
  {
    name: 'library_add',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        documents: {
          type: 'array',
          maxItems: MANY,
          items: {
            type: 'object',
            properties: {
              url: str(
                'the web address of a PDF, Word or OpenDocument file, a ' +
                  'spreadsheet, a web page or a plain text file',
              ),
              attachment: str(
                "the id of a file the person attached in a conversation with you, as their message names it ('attachment <id>')",
              ),
              base64: str("the file's bytes, base64, with name"),
              name: str(
                "the document's name, which an answer cites: required with " +
                  "attachment and base64; with url, in place of the page's " +
                  'title or the file name the site gives',
              ),
              replaces: str(
                'the eid of a document in the library this one replaces, ' +
                  'which is removed once this one is added',
              ),
            },
          },
          description:
            `up to ${MANY} documents, each one of url, attachment or base64`,
        },
      },
      required: ['app', 'documents'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args)
      let list = documentsOf(args)
      let results = await added(ctx, space, app, who, store, list)
      let ok = results.filter((r) => r.ok)
      let skipped = results.filter((r) => !r.ok)
      return {
        text: [
          `${ok.length} of ${results.length} added to ${space.slug}/${app.slug}` +
          (ok.length
            ? '; their text is being read, and library_list says when each is searchable'
            : ''),
          ...results.map((r) =>
            r.ok
              ? `- added ${r.name} (${r.eid})${
                r.label != r.name ? ` from ${r.label}` : ''
              }${r.replaced ? `, replacing ${r.replaced}` : ''}`
              : `- skipped ${r.label}: ${line(r.reason)}`
          ),
        ].join('\n'),
        space,
        value: {
          added: ok.map(({ ok: _, label, ...r }) => ({ ...r, from: label })),
          skipped: skipped.map((r) => ({
            from: r.label,
            reason: r.ok ? '' : r.reason,
          })),
        },
      }
    },
  },
  {
    name: 'library_list',
    readOnly: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args)
      let rows = (await shelf(store, who).query(SHELF)).filter((r) => {
        let a = r.attachment as Comp
        return supported(String(a.name ?? ''), String(a.mime ?? ''))
      })
      let documents = rows.map((r) => {
        let a = r.attachment as Comp
        return {
          eid: r.entity.eid,
          name: String(a.name ?? ''),
          mime: String(a.mime ?? ''),
          ...a.source ? { source: String(a.source) } : {},
          ...stateOf(r),
        }
      })
      return {
        text: documents.length
          ? [
            `${documents.length} document${
              documents.length == 1 ? '' : 's'
            } in ${space.slug}/${app.slug}:`,
            ...documents.map((d) =>
              `- ${d.name || '(no name)'} (${d.eid}) — ${
                d.state == 'failed'
                  ? `could not be read: ${d.reason}`
                  : d.state == 'searchable'
                  ? `${d.pages} page${d.pages == 1 ? '' : 's'} searchable`
                  : 'reading…'
              }${d.source ? `, from ${d.source}` : ''}`
            ),
          ].join('\n')
          : `${space.slug}/${app.slug} has no documents; library_add adds them`,
        space,
        value: { documents },
      }
    },
  },
  {
    name: 'library_read',
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        document: str('the eid of the document, from library_list'),
        page: {
          type: 'integer',
          minimum: 1,
          description: 'the page to start at, counting from 1 (1 if left out)',
        },
      },
      required: ['app', 'document'],
    },
    run: async (ctx, args) => {
      let { space, who, store } = await inApp(ctx, args)
      let eid = text(args.document, 'document')
      let graph = shelf(store, who)
      let [row] = await attachmentsAt(graph, [eid])
      let from = args.page == null ? 1 : Number(args.page)
      if (!(Number.isSafeInteger(from) && from >= 1)) {
        throw refuse('arguments', `page: ${args.page} — a whole number from 1`)
      }
      let state = stateOf(row)
      if (state.state != 'searchable') {
        throw refuse(
          'conflict',
          state.state == 'failed'
            ? `${eid} could not be read: ${state.reason}`
            : `${eid} is still being read; library_list says when it is searchable`,
        )
      }
      let pages = (await graph.query(`.document_page.document=${eid}`))
        .map((b) => b.document_page as Comp)
        .sort((a, b) => Number(a.page) - Number(b.page))
        .filter((p) => Number(p.page) >= from)
      let out: string[] = [], size = 0, last = from - 1
      for (let p of pages) {
        let said = `## ${p.location}\n\n${p.text}`
        if (out.length && size + said.length > READ) break
        out.push(said.slice(0, READ))
        size += said.length
        last = Number(p.page)
      }
      let count = Number(state.pages)
      let more = last < count
      return {
        text: out.join('\n\n') +
          (more
            ? `\n\n(pages ${from}–${last} of ${count}; page: ${
              last + 1
            } reads on)`
            : ''),
        space,
        value: {
          document: eid,
          pages: count,
          from,
          to: last,
          ...more ? { next: last + 1 } : {},
        },
      }
    },
  },
  {
    name: 'library_remove',
    destructive: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        documents: {
          type: 'array',
          items: { type: 'string' },
          description: 'the eids of the documents to remove, from library_list',
        },
      },
      required: ['app', 'documents'],
    },
    run: async (ctx, args) => {
      let { space, app, who, store } = await inApp(ctx, args, true)
      let eids = Array.isArray(args.documents)
        ? args.documents.map((d, i) => text(d, `documents[${i}]`))
        : []
      if (!eids.length) {
        throw refuse('arguments', 'documents: the eids of documents to remove')
      }
      let graph = metaOf(store, await byCaller(ctx, who))
      let rows = await attachmentsAt(graph, eids)
      await graph.apply(rows.flatMap(removal)).catch((e) => {
        throw refusal(e)
      })
      return {
        text: `removed ${
          rows.map((r) => `${(r.attachment as Comp).name} (${r.entity.eid})`)
            .join(', ')
        } from ${space.slug}/${app.slug}, its file and its extracted text`,
        space,
        value: { removed: eids },
      }
    },
  },
]
