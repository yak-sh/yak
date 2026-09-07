#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=deno
// The Worker's words, out of the files they are written in and into the one
// module it imports (T-34606, M-34605): `content.ts`, which nobody edits.
//
//   deno task content            rewrite content.ts
//   deno task content --check    fail (exit 1) if it is stale
//
// WHY A STEP AT ALL. A Worker has no filesystem: a page, a prompt and a tool's
// description have to be IN the bundle by the time the isolate starts, and the
// roster is assembled at module load. So the files are read here, where there
// is a Deno, and what the runtime sees is a projection of them — the same deal
// src/vocab/gen.ts makes with the fleet's vocabulary, and the reason
// `deno task check` refuses a stale one.
//
// The guide pages are the exception that proves it: their BYTES already ship,
// under public/, and are served at the address the guide tool reads them back
// from. What is projected here is only the ROW — the slug, title, description
// and brief the connector lists a page by — which is what guide.ts held as a
// literal until the page itself could say it.
//
// The same step also fills the PLUGIN package (T-34666) — `plugins/yaks.app/`,
// which `.agents/plugins/marketplace.json` offers — because a plugin is a
// directory of files on somebody else's disk: the guide has to travel as bytes
// there too, one skill per page, and the icon with it. Same deal, same refusal.
import { front, read } from '@yaks/yaml'

let HERE = new URL('.', import.meta.url)
let TARGET = new URL('content.ts', HERE)
let PLUGIN = new URL('../../plugins/yaks.app/', HERE)

let refuse = (why: string): never => {
  console.error(why)
  Deno.exit(1)
}

// Every file of a kind, by name, so the emitted module is stable whatever
// order the directory hands them back in.
let filesIn = (dir: URL, ext: string) =>
  [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(ext))
    .sort()

let said = (v: unknown, where: string): string =>
  typeof v == 'string' && v.trim() ? v : refuse(`${where} is missing`)

/** Every guide page, read once: public/guide/<slug>.md, where `doc` says the
 * title, `guide` says what the connector lists it by, and the rest is the page.
 *
 * The file names no ENTITY: `guide.slug` is declared `identity` (see
 * content.vocab.json), so the page is its slug wherever it is read — here, and
 * in a store the day one applies it (T-34649). Which is why the refusal below
 * matters as much as the row: the slug and the filename are one fact. */
let guides = () =>
  filesIn(new URL('public/guide/', HERE), '.md').map((name) => {
    let file = `public/guide/${name}`
    let slug = name.slice(0, -3)
    let { meta, body } = front(Deno.readTextFileSync(new URL(file, HERE)), file)
    let doc = meta.doc as Record<string, unknown> ?? {}
    let guide = meta.guide as Record<string, unknown> ?? {}
    if (guide.slug != slug) {
      refuse(`${file}: guide.slug is ${guide.slug}, not ${slug}`)
    }
    return {
      slug,
      title: said(doc.title, `${file} doc.title`),
      description: said(guide.description, `${file} guide.description`),
      brief: said(guide.brief, `${file} guide.brief`),
      body,
    }
  })

let GUIDES = guides()

/** Each guide page's row, by slug — what the connector lists a page by. */
let pages = () =>
  Object.fromEntries(
    GUIDES.map(({ slug, title, description, brief }) => [
      slug,
      { slug, title, description, brief },
    ]),
  )

/** Each prompt, by name: prompts/<name>.md — the row in its frontmatter and
 * the person's own message under it, slots and all. `prompt.name` is the
 * identity, the way a page's slug is, and the refusal keeps it and the
 * filename one fact. */
let prompts = () => {
  let dir = new URL('prompts/', HERE)
  let out: Record<string, unknown> = {}
  for (let file of filesIn(dir, '.md')) {
    let at = `prompts/${file}`
    let name = file.slice(0, -3)
    let { meta, body } = front(Deno.readTextFileSync(new URL(file, dir)), at)
    let row = meta.prompt as Record<string, unknown> ?? {}
    if (row.name != name) {
      refuse(`${at}: prompt.name is ${row.name}, not ${name}`)
    }
    out[name] = {
      name,
      title: said(row.title, `${at} prompt.title`),
      description: said(row.description, `${at} prompt.description`),
      arguments: row.arguments ?? [],
      // The message starts at its first word and ends at its last: the blank
      // line under the frontmatter and the newline the file ends with are the
      // FILE's punctuation, not the person's.
      body: body.replace(/^\n+/, '').replace(/\n+$/, ''),
    }
  }
  return out
}

/** What every tool says about itself, by name: tools.yml. */
let words = () => {
  let at = 'tools.yml'
  let held = read(Deno.readTextFileSync(new URL(at, HERE)), at)
  if (!held || typeof held != 'object' || Array.isArray(held)) {
    refuse(`${at} is not a map of tool name to {title, description}`)
  }
  let out: Record<string, unknown> = {}
  for (let [name, row] of Object.entries(held as Record<string, unknown>)) {
    let one = row as Record<string, unknown>
    out[name] = {
      title: said(one?.title, `${at} ${name}.title`),
      description: said(one?.description, `${at} ${name}.description`),
    }
  }
  return out
}

let HEAD = `// GENERATED — do not edit. The words live in the files:
// public/guide/*.md (a page's frontmatter), prompts/*.md (a prompt's), and
// tools.yml (what each tool says about itself). Change one of those and run
// \`deno task content\`; \`deno task content --check\` refuses this file when it
// has fallen behind (gen.ts, T-34606).
//
// A Worker has no filesystem, so this is how words written in files reach an
// isolate: as a module it imports like any other. The types are the
// hand-written ones this stands in for, imported for their shape alone.
import type { Page } from './guide.ts'
import type { Said } from './prompts.ts'
import type { Words } from './tool.ts'
`

let body = () =>
  [
    HEAD,
    "/** Every guide page's row, by slug. */",
    `export let PAGES: Record<string, Page> = ${
      JSON.stringify(pages(), null, 2)
    }\n`,
    '/** Every prompt this door offers, by name. */',
    `export let SAYS: Record<string, Said> = ${
      JSON.stringify(prompts(), null, 2)
    }\n`,
    '/** What every tool says about itself, by name. */',
    `export let WORDS: Record<string, Words> = ${
      JSON.stringify(words(), null, 2)
    }\n`,
  ].join('\n')

// The emitted text as it will be COMMITTED — deno fmt is the last word on it,
// so the stale check compares like with like. The temp file lives inside the
// project, where the fmt subprocess resolves this repo's config.
let formatted = async (text: string) => {
  let tmp = new URL('.content.gen.ts', HERE)
  await Deno.writeTextFile(tmp, text)
  let p = await new Deno.Command('deno', {
    args: ['fmt', '-q', tmp.pathname],
  }).output()
  if (!p.success) {
    refuse(`deno fmt failed: ${new TextDecoder().decode(p.stderr)}`)
  }
  let out = await Deno.readTextFile(tmp)
  await Deno.remove(tmp)
  return out
}

// ---- the plugin package (T-34666) ----------------------------------------
//
// What `plugins/yaks.app/` holds a COPY of, by path under the plugin root. A
// plugin is unpacked onto somebody else's disk and read there, so the guide
// travels as files: one skill per page, whose frontmatter is the page's own
// row and whose body is the page. The icons travel for the same reason — the
// manifest's `logo` and `composerIcon` must point at real files inside the
// package — and they are the connector's own, so the plugin cannot come to
// wear a different face than the connect page hands out.
//
// Everything else under the plugin root (.codex-plugin/plugin.json, .mcp.json)
// is written by HAND: it is the package's own words and address, not a
// projection of anything.
let OWNED = ['skills', 'assets']

let bytes = new TextEncoder()

// The skills as they will be COMMITTED. deno fmt formats markdown and its
// frontmatter, and this repo's config is the last word on a quote, so the
// stale check has to compare what fmt would leave behind rather than what this
// file happened to emit. One subprocess for the whole tree; the temp directory
// lives inside the project, where the fmt subprocess resolves this repo's
// config, the same deal `formatted` above makes for content.ts.
let formattedMd = async (held: Record<string, string>) => {
  let tmp = new URL('../../plugins/.gen/', HERE)
  await Deno.remove(tmp, { recursive: true }).catch(() => {})
  for (let [path, text] of Object.entries(held)) {
    let to = new URL(path, tmp)
    await Deno.mkdir(new URL('.', to), { recursive: true })
    await Deno.writeTextFile(to, text)
  }
  let p = await new Deno.Command('deno', {
    args: ['fmt', '-q', tmp.pathname],
  }).output()
  if (!p.success) {
    refuse(`deno fmt failed: ${new TextDecoder().decode(p.stderr)}`)
  }
  let out: Record<string, string> = {}
  for (let path of Object.keys(held)) {
    out[path] = await Deno.readTextFile(new URL(path, tmp))
  }
  await Deno.remove(tmp, { recursive: true })
  return out
}

let packaged = async (): Promise<Record<string, Uint8Array>> => {
  let md: Record<string, string> = {}
  for (let { slug, description, body } of GUIDES) {
    // The description is JSON-encoded, which is a YAML double-quoted scalar
    // too: a page's own sentence may hold a colon or a quote and still land
    // as one string. It is prefixed with the product because a skill's
    // description is read on its own, in a list beside every other plugin's.
    md[`skills/${slug}/SKILL.md`] = `---\nname: ${slug}\ndescription: ${
      JSON.stringify(`yaks.app — ${description}`)
    }\n---\n\n${body.replace(/^\n+/, '').replace(/\n+$/, '')}\n`
  }
  let out: Record<string, Uint8Array> = {
    'assets/logo.png': Deno.readFileSync(
      new URL('public/connector-512.png', HERE),
    ),
    'assets/icon.png': Deno.readFileSync(new URL('public/yaks-app.png', HERE)),
  }
  for (let [path, text] of Object.entries(await formattedMd(md))) {
    out[path] = bytes.encode(text)
  }
  return out
}

// Every file under a directory, by path relative to it — absent is empty, so
// a package that was never generated reads as one that is stale.
let under = (dir: URL, at = ''): string[] => {
  let held: Deno.DirEntry[] = []
  try {
    held = [...Deno.readDirSync(dir)]
  } catch {
    return []
  }
  return held.flatMap((e) =>
    e.isDirectory
      ? under(new URL(`${e.name}/`, dir), `${at}${e.name}/`)
      : [`${at}${e.name}`]
  )
}

let same = (a: Uint8Array, b: Uint8Array) =>
  a.length == b.length && a.every((x, i) => x == b[i])

// The package is a DIRECTORY, so the stale check is the whole tree: a guide
// page that went away has to take its skill with it, and a set that still
// matches path for path can still differ byte for byte.
let stale = (files: Record<string, Uint8Array>) => {
  let held = OWNED.flatMap((d) => under(new URL(`${d}/`, PLUGIN), `${d}/`))
  if (held.sort().join('\n') != Object.keys(files).sort().join('\n')) {
    return true
  }
  return Object.entries(files).some(([path, want]) =>
    !same(want, Deno.readFileSync(new URL(path, PLUGIN)))
  )
}

// Written by replacing what gen.ts owns, so a removal is carried out rather
// than left behind. Nothing outside OWNED is touched.
let pack = (files: Record<string, Uint8Array>) => {
  for (let d of OWNED) {
    try {
      Deno.removeSync(new URL(`${d}/`, PLUGIN), { recursive: true })
    } catch {
      // never generated, or already gone
    }
  }
  for (let [path, held] of Object.entries(files)) {
    let to = new URL(path, PLUGIN)
    Deno.mkdirSync(new URL('.', to), { recursive: true })
    Deno.writeFileSync(to, held)
  }
}

let fresh = await formatted(body())
let files = await packaged()
if (Deno.args.includes('--check')) {
  let held = await Deno.readTextFile(TARGET).catch(() => '')
  if (held != fresh) {
    refuse(
      'workers/yak/content.ts is stale — run `deno task content` and commit it',
    )
  }
  if (stale(files)) {
    refuse(
      'plugins/yaks.app is stale — run `deno task content` and commit it',
    )
  }
} else {
  await Deno.writeTextFile(TARGET, fresh)
  pack(files)
}
