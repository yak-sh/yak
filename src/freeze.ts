// URL freezing — the server-side archive pipeline. A pasted URL never
// renders live: monolith snapshots it into ONE self-contained HTML file,
// scrub() strips every remaining external reference, and the archive is
// served back under a no-script/no-network CSP. Server-only.
import { parseHTML } from 'linkedom'
import { type Change } from './types.ts'
import { db } from './db.ts'

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
  cast(changes)
  return Response.json(changes)
}

let webRow = (eid: string) =>
  db.prepare('select url from web where eid = ?').get(eid) as
    | { url: string }
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

// The upload door: same store, same scrub, same stamp — the page just
// arrives over the wire (an agent one-shotting a mockup or report)
// instead of through monolith. The web row must already exist (the
// uploader mints it first), so a bare POST can't spray files onto disk.
export let store = async (
  eid: string,
  raw: string,
  cast: (c: Change[]) => void,
) => {
  if (!webRow(eid)) return new Response('no such web entity', { status: 404 })
  Deno.mkdirSync(frozen, { recursive: true })
  let { html, title } = scrub(raw)
  await Deno.writeTextFile(`${frozen}/${eid}.html`, html)
  return land(eid, title, cast)
}

// Serve an archive. eid is validated to a bare uuid — no path escapes.
// The CSP mirrors the iframe's sandbox but holds in EVERY context (an
// archive opened directly in a tab has no iframe to sandbox it): no
// scripts, no network fetches — the freeze stays inert and offline.
export let serveFrozen = async (eid: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(eid)) return new Response('no', { status: 400 })
  try {
    return new Response(await Deno.readFile(`${frozen}/${eid}.html`), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "sandbox allow-same-origin; script-src 'none'; connect-src 'none'",
      },
    })
  } catch {
    return new Response('not frozen', { status: 404 })
  }
}
