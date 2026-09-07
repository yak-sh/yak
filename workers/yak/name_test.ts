/// <reference lib="deno.ns" />
// The product has ONE spelling: yaks.app — lowercase, with the .app. An agent
// that read the address a dozen times and the name not once invented "Yaks"
// and told its person that was what the place is called (T-34302), so the
// name is now said outright in the three things read first. This file is the
// gate that keeps it said (T-34558).
//
// The walks below are a DIRECTORY and a ROSTER, never a hand-kept list: a page
// dropped into public/, a tool added to TOOLS, a letter written in a module
// that does not exist yet — each is covered the day it lands, and a leak fails
// here instead of reaching somebody's screen.
import { assert, assertStringIncludes } from '@std/assert'
import { core } from '@yaks/mcp'
import { INSTRUCTIONS, PAGES, UNDO } from './guide.ts'
import { DOCS, PUBLIC } from './preauth.ts'
import { PROMPTS } from './prompts.ts'
import { CONNECTOR } from './seo.ts'
import { TOOLS } from './tools.ts'
import { platformVocab } from './vocab.ts'

// The name we never write. Two things wearing this shape are not it: an email
// address, where case has never mattered and the guide says so
// (`Ada.Cookbook@Yaks.App`), and the spelling itself.
let bare = /(?<!@)\bYaks\b(?!\.[Aa]pp)/

let leak = (where: string, text: string) => {
  let hit = bare.exec(text)
  if (!hit) return
  let lines = text.slice(0, hit.index).split('\n')
  let line = text.split('\n')[lines.length - 1].trim().slice(0, 100)
  assert(false, `${where}:${lines.length} says "Yaks", not yaks.app — ${line}`)
}

// A comment may name the mistake — this one does. Blanked rather than dropped,
// so the line numbers a failure prints still point at the file.
let comment = /^\s*(\/\/|\*|\/\*)/
let code = (text: string) =>
  text.split('\n').map((l) => comment.test(l) ? '' : l).join('\n')

// Anything a person or an agent reads: the served pages, the guide's markdown,
// the worked example, and the modules that build a page or a letter out of
// words. Not a test — nobody is handed one.
let READ = /\.(html|md|css|js|txt|json|svg|webmanifest)$/
let source = /(?<!_test)\.ts$/

let walk = function* (dir: URL, at = ''): Generator<[string, string]> {
  for (
    let e of [...Deno.readDirSync(dir)].sort((a, b) => a.name < b.name ? -1 : 1)
  ) {
    let path = at ? `${at}/${e.name}` : e.name
    if (e.isDirectory) yield* walk(new URL(`${e.name}/`, dir), path)
    else if (READ.test(e.name)) {
      yield [path, Deno.readTextFileSync(new URL(e.name, dir))]
    } else if (source.test(e.name)) {
      yield [path, code(Deno.readTextFileSync(new URL(e.name, dir)))]
    }
  }
}

// This tree, the words the connector package hands an agent, and the CLI's
// own help. `src/yak.ts` is one file, read below.
let roots = ['./', '../../packages/mcp/', '../../packages/cli/']

Deno.test('nothing served or written here calls the place Yaks', () => {
  let seen = 0
  for (let root of roots) {
    for (let [path, text] of walk(new URL(root, import.meta.url))) {
      leak(`${root}${path}`, text)
      seen++
    }
  }
  // A walk that lost its directory passes every assertion in it.
  assert(seen > 60, `walked only ${seen} files`)
  let yak = new URL('../../src/yak.ts', import.meta.url)
  leak('src/yak.ts', code(Deno.readTextFileSync(yak)))
})

// What an agent is handed through the connector: the server's own face and
// instructions, the guide's table of contents, the resources, the prompts, and
// every tool's title, description and schema. JSON is the whole tool at once —
// stringify drops the `run`, the only part of it nobody reads. Signed out the
// roster is the same list wearing a different `security` (anon.ts `barred`),
// so this walk is both doors.
Deno.test('nothing the connector says calls the place Yaks', () => {
  leak('INSTRUCTIONS', INSTRUCTIONS)
  leak('CONNECTOR', JSON.stringify(CONNECTOR))
  leak('guide PAGES', JSON.stringify(PAGES))
  leak('preauth DOCS', JSON.stringify(DOCS))
  leak('preauth PUBLIC', JSON.stringify(PUBLIC))
  leak('PROMPTS', JSON.stringify(PROMPTS))
  // The generic tier as it is ASSEMBLED — the package writes some of these
  // descriptions out of pieces, and the pieces are not what a host reads.
  let generic = core({ vocab: platformVocab(), undo: UNDO })
  assert(
    generic.length > 3,
    `the generic tier came back with ${generic.length}`,
  )
  assert(TOOLS.length > 10, `the tool roster came back with ${TOOLS.length}`)
  for (let t of [...TOOLS, ...generic]) {
    leak(`tool ${t.name}`, JSON.stringify(t))
  }
})

// And it says the name outright, because saying only the address is what left
// an agent guessing at it.
Deno.test('the instructions teach the spelling', () => {
  assertStringIncludes(INSTRUCTIONS, 'This is yaks.app')
  assertStringIncludes(INSTRUCTIONS, 'lowercase, with the .app')
})
