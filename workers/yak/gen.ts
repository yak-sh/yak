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
import { front, read } from '@yaks/yaml'

let HERE = new URL('.', import.meta.url)
let TARGET = new URL('content.ts', HERE)

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

/** Each guide page's row, by slug: public/guide/<slug>.md frontmatter, where
 * `doc` says the title and `guide` says what the connector lists it by. */
let pages = () => {
  let dir = new URL('public/guide/', HERE)
  let out: Record<string, unknown> = {}
  for (let name of filesIn(dir, '.md')) {
    let file = `public/guide/${name}`
    let slug = name.slice(0, -3)
    let { meta } = front(Deno.readTextFileSync(new URL(name, dir)), file)
    let doc = meta.doc as Record<string, unknown> ?? {}
    let guide = meta.guide as Record<string, unknown> ?? {}
    if (guide.slug != slug) {
      refuse(`${file}: guide.slug is ${guide.slug}, not ${slug}`)
    }
    out[slug] = {
      slug,
      title: said(doc.title, `${file} doc.title`),
      description: said(guide.description, `${file} guide.description`),
      brief: said(guide.brief, `${file} guide.brief`),
    }
  }
  return out
}

/** Each prompt, by name: prompts/<name>.md — the row in its frontmatter and
 * the person's own message under it, slots and all. */
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

let fresh = await formatted(body())
if (Deno.args.includes('--check')) {
  let held = await Deno.readTextFile(TARGET).catch(() => '')
  if (held != fresh) {
    refuse(
      'workers/yak/content.ts is stale — run `deno task content` and commit it',
    )
  }
} else {
  await Deno.writeTextFile(TARGET, fresh)
}
