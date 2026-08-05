// URL freezing — the server-side archive pipeline. A pasted URL never
// renders live: monolith snapshots it into ONE self-contained HTML file,
// scrub() strips every remaining external reference, and the archive is
// served back under a no-script/no-network CSP. A page DELIVERED over
// the wire (page_put) is an agent's own artifact and lands as-is —
// provenance, not storage, decides the trust. Server-only.
import { parseHTML } from 'linkedom'
import { type Change } from './types.ts'
import { db, record } from './db.ts'

// Freeze a pasted URL: monolith fetches the page and inlines every asset
// into ONE self-contained, script-free, network-isolated HTML file. It
// lands on disk (an inlined page is megabytes — the db and every snapshot
// stay lean), the entity's web comp gets frozen_at (server-stamped; the
// wire allowlist doesn't carry it, so clients can't fake an archive), the
// page <title> becomes the entity's doc, and everyone hears over the ws.
let frozen = `${Deno.env.get('HOME')}/.tasks/frozen`

// Self-containment is enforced HERE, not at render: monolith inlines what
// it can reach, but anything it couldn't (404'd assets, preload hints,
// srcset variants, favicons) keeps its URL and would fetch when shown.
// The archive must render from its own bytes alone, so every remaining
// external reference is REMOVED: leftover scripts/frames/link tags, every
// url-bearing attribute that isn't data:, inline handlers, and url() in
// CSS. Returns the scrubbed page and its title (for the entity's doc).
let URLISH = [
  'src',
  'href',
  'srcset',
  'poster',
  'action',
  'formaction',
  'ping',
  'background',
  'data',
  'xlink:href',
]
let cssScrub = (css: string) =>
  css.replace(/url\(\s*(?!['"]?\s*data:)[^)]*\)/gi, 'url()')
let titleOf = (raw: string) =>
  parseHTML(raw).document.querySelector('title')?.textContent?.trim()
let scrub = (raw: string) => {
  let { document } = parseHTML(raw)
  let all = (sel: string) => [...document.querySelectorAll(sel)]
  for (let el of all('script, base, iframe, frame, embed, object')) {
    el.remove()
  }
  for (let el of all('link')) {
    if (!(el.getAttribute('href') ?? '').startsWith('data:')) el.remove()
  }
  for (let el of all('meta[http-equiv]')) {
    if (/refresh/i.test(el.getAttribute('http-equiv') ?? '')) el.remove()
  }
  for (let el of all('*')) {
    for (let { name } of [...el.attributes]) {
      if (name.startsWith('on')) el.removeAttribute(name)
    }
    for (let a of URLISH) {
      let v = el.getAttribute(a)
      if (v && !/^\s*(data:|#|about:)/i.test(v)) el.removeAttribute(a)
    }
    let style = el.getAttribute('style')
    if (style?.includes('url(')) el.setAttribute('style', cssScrub(style))
  }
  for (let el of all('style')) el.textContent = cssScrub(el.textContent ?? '')
  return {
    html: document.toString(),
    title: document.querySelector('title')?.textContent?.trim(),
  }
}

// The archive landing, shared by both doors: stamp frozen_at (server-
// owned), adopt the page <title> as the entity's doc when it has none,
// and tell every live client.
let land = (
  eid: string,
  title: string | undefined,
  cast: (c: Change[]) => void,
) => {
  let changes: Change[] = [
    { eid, name: 'web', comp: { frozen_at: new Date().toISOString() } },
  ]
  db.prepare('update web set frozen_at = ? where eid = ?')
    .run(changes[0].comp!.frozen_at as string, eid)
  let hasDoc = db.prepare('select 1 from doc where eid = ?').get(eid)
  if (title && !hasDoc) {
    db.prepare('insert into doc (eid, title) values (?, ?)').run(eid, title)
    changes.push({ eid, name: 'doc', comp: { title } })
  }
  // The stamp must reach the journal as well as the sockets: a tab that
  // boots by catch-up replay hears only journal batches, and an archive
  // whose frozen_at it never hears renders as "freezing …" forever.
  record(db, changes)
  cast(changes)
  return Response.json(changes)
}

let webRow = (eid: string) =>
  db.prepare('select url, frozen_at from web where eid = ?').get(eid) as
    | { url: string; frozen_at: string | null }
    | undefined

export let freeze = async (eid: string, cast: (c: Change[]) => void) => {
  let row = webRow(eid)
  if (!row) return new Response('no such web entity', { status: 404 })
  Deno.mkdirSync(frozen, { recursive: true })
  let out = `${frozen}/${eid}.html`
  let cmd = await new Deno.Command('monolith', {
    args: ['-j', '-f', '-I', '-q', '-t', '30', '-o', out, row.url],
  }).output()
  if (!cmd.success) {
    console.warn(
      'freeze failed:',
      row.url,
      new TextDecoder().decode(cmd.stderr),
    )
    return new Response('freeze failed', { status: 502 })
  }
  let { html, title } = scrub(await Deno.readTextFile(out))
  await Deno.writeTextFile(out, html)
  return land(eid, title, cast)
}

// The upload door: same store, same stamp, but NO scrub — the page
// arrives over the wire (an agent one-shotting a mockup or report), and
// the author's bytes are the artifact: inline scripts and external refs
// are the point, not a leak. `scrubbed` keeps the inert form available
// for a caller that wants it. The web row must already exist (the
// uploader mints it first), so a bare POST can't spray files onto disk.
export let store = async (
  eid: string,
  raw: string,
  cast: (c: Change[]) => void,
  scrubbed = false,
) => {
  if (!webRow(eid)) return new Response('no such web entity', { status: 404 })
  Deno.mkdirSync(frozen, { recursive: true })
  let { html, title } = scrubbed
    ? scrub(raw)
    : { html: raw, title: titleOf(raw) }
  await Deno.writeTextFile(`${frozen}/${eid}.html`, html)
  return land(eid, title, cast)
}

// Serve an archive. eid is validated to a bare uuid — no path escapes.
// The CSP mirrors the iframe's sandbox but holds in EVERY context (an
// archive opened directly in a tab has no iframe to sandbox it), and
// provenance picks it: a URL freeze (web.url set) stays inert and
// offline — no scripts, no network; a delivered page runs its scripts
// and loads what it references, but in an opaque origin, so it never
// acts as the app.
// An archive also SAYS what it is an archive of, in the words the web
// already has for it (RFC 7089): Memento-Datetime is the moment these
// bytes were what the page said, and the original link is the address
// they were said at. Both halves come off the same row whichever door
// filled it — a refetch or a browser's own witness — so a reader can
// date a snapshot without asking the graph.
export let serveFrozen = async (eid: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(eid)) return new Response('no', { status: 400 })
  let row = webRow(eid)
  let csp = row?.url
    ? "sandbox allow-same-origin; script-src 'none'; connect-src 'none'"
    : 'sandbox allow-scripts'
  let at = row?.frozen_at ? new Date(row.frozen_at) : null
  try {
    return new Response(await Deno.readFile(`${frozen}/${eid}.html`), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': csp,
        ...at && !isNaN(+at) ? { 'memento-datetime': at.toUTCString() } : {},
        ...row?.url ? { link: `<${row.url}>; rel="original"` } : {},
      },
    })
  } catch {
    return new Response('not frozen', { status: 404 })
  }
}
