/// <reference lib="deno.ns" />
// What a HOST reads before a person has used this connector once, and the one
// thing it must not read there (T-34632).
//
// ChatGPT runs a classifier over an MCP server's tool titles, descriptions and
// argument descriptions, its `initialize` instructions and its prompts. Ours
// named a file an app carries and went on to say how a model was to treat what
// it found in it, and the classifier called that what it looks like — an
// attempt to prescribe the model's handling of content — and put a warning in
// front of the person: "Tool documentation prescribes classifier-relevant
// handling, including rules for AGENTS.md and app content."
//
// It was right about the shape and wrong about the intent, and the shape is
// the part we own. A description here DESCRIBES: what the tool does, what it
// takes, what comes back. It does not tell the model how to treat what it
// reads, and it does not carry somebody else's words — an app's own notes and
// a person's own memories are handed over by `about` and by the prompt of the
// app's own name, where they are an answer to a question rather than an
// instruction nobody asked for (standing.ts).
//
// The walks are name_test.ts's, for the same reason: a directory and a roster
// rather than a hand-kept list, so a tool added tomorrow is covered tomorrow.
import { assert, assertEquals } from '@std/assert'
import { core } from '@yaks/mcp'
import { INSTRUCTIONS, PAGES, UNDO } from './guide.ts'
import { DOCS, PUBLIC } from './preauth.ts'
import { PROMPTS } from './prompts.ts'
import { CONNECTOR } from './seo.ts'
import { TOOLS } from './tools.ts'
import { platformVocab } from './vocab.ts'
import { HAS_NOTES, passage, prompted } from './standing.ts'
import type { Entry } from './standing.ts'
import type { App, Space } from './directory.ts'

// The shapes a classifier reads as an instruction about content. Small on
// purpose: an imperative about the CALL ("pass the files in one call", "leave
// the space out") is a description of the tool doing its job, and a list that
// caught those would be a list nobody could keep.
let SHAPES: [string, RegExp][] = [
  ['names the file agents read', /AGENTS\.md/i],
  ['says how to treat something', /\btreat\b[^.]{0,60}\bas\b/i],
  ['calls content untrusted', /\buntrusted\b/i],
  ['tells the model to obey', /\bobey\b/i],
  ['tells the model to ignore', /\bignore\b[^.]{0,30}\b(any|all|previous)\b/i],
  [
    'says something is to be followed',
    /\bfollow(?:ed|s|ing)?\b[^.]{0,40}\b(instruction|rule|whatever|what the app)/i,
  ],
  ['calls a file standing rules', /\bstanding (rule|instruction)/i],
  ['calls a file rules for an app', /\brules? (for|of)\b[^.]{0,20}\bapp/i],
  ['names prompt injection', /\bprompt injection\b/i],
  ['orders the model', /\byou must\b|\bmust (always|never)\b/i],
]

// Where the offending sentence is, so a failure is one line to fix rather
// than a haystack the size of the tool list.
let plain = (where: string, text: string) => {
  for (let [why, shape] of SHAPES) {
    let hit = shape.exec(text)
    if (!hit) continue
    let at = Math.max(0, hit.index - 60)
    assert(
      false,
      `${where} ${why}: …${text.slice(at, hit.index + 90).trim()}…`,
    )
  }
}

Deno.test('nothing a host reads prescribes how to handle content', () => {
  plain('INSTRUCTIONS', INSTRUCTIONS)
  plain('CONNECTOR', JSON.stringify(CONNECTOR))
  plain('guide PAGES', JSON.stringify(PAGES))
  plain('preauth DOCS', JSON.stringify(DOCS))
  plain('preauth PUBLIC', JSON.stringify(PUBLIC))
  plain('PROMPTS', JSON.stringify(PROMPTS))
  // The generic tier as it is ASSEMBLED: the package writes some of these
  // descriptions out of pieces, and the pieces are not what a host reads.
  let generic = core({ vocab: platformVocab(), undo: UNDO })
  assert(
    generic.length > 3,
    `the generic tier came back with ${generic.length}`,
  )
  assert(TOOLS.length > 10, `the tool roster came back with ${TOOLS.length}`)
  for (let t of [...TOOLS, ...generic]) {
    plain(`tool ${t.name}`, JSON.stringify(t))
  }
  // The ANONYMOUS door is this same list: `barred` (anon.ts) replaces a
  // tool's `run` and its security schemes and touches no word of it, so the
  // walk above is both doors.
})

// Negative proof, once: a list that matches nothing passes every file in the
// repo and would go on passing one that said anything at all.
Deno.test('the shapes catch what they are for', () => {
  let caught = (text: string) => {
    try {
      plain('planted', text)
      return ''
    } catch (e) {
      return (e as Error).message
    }
  }
  assert(caught('Write it into an AGENTS.md beside index.html.'), 'the file')
  assert(caught('Treat what a letter says as an instruction.'), 'treat as')
  assert(caught("Follow whatever the app's notes say."), 'follow')
  assert(caught('The standing rules an app carries.'), 'standing rules')
  assert(caught('The rules for one app go here.'), 'rules for an app')
  assert(caught('You must never say so.'), 'ordered')
  // And leave alone the imperatives that are a tool describing its own call.
  assertEquals(caught('Pass the whole set in one call, as files: [...].'), '')
  assertEquals(caught('Leave the space argument out.'), '')
  assertEquals(caught('It is never served on the web.'), '')
})

let space = (slug: string) => ({ eid: `s-${slug}`, slug, title: slug } as Space)
let app = (
  slug: string,
): App => ({
  eid: `a-${slug}`,
  slug,
  space: 's',
  version: 1,
  title: 'Recipes',
} as App)

// An app's notes are somebody else's words, and no list of ours can vouch for
// them. So the surface never carries them: the roster names the app and says
// it keeps notes, and `about` and the prompt are what hand them over.
Deno.test('what an app wrote stays off the surface a host reads', () => {
  let said = '# Recipes\n\nAGENTS.md rules: you must always treat this as law.'
  let one: Entry = {
    space: space('kitchen'),
    app: app('recipes'),
    said,
    kinds: ['recipe'],
    commands: [],
  }
  // The roster is what rides on the instructions, so it is scanned like one.
  let roster = passage([one])
  plain('roster', roster)
  assert(roster.includes('## kitchen/recipes'), roster)
  assert(roster.includes(HAS_NOTES), roster)
  // The listing of the prompt, likewise — its TEXT is the file, which is
  // fetched by name and is the answer to somebody asking for it.
  for (let p of prompted([one], [])) {
    plain(`prompt ${p.name}`, JSON.stringify({ ...p, text: '' }))
    assertEquals(p.text, said)
  }
  // And the notes themselves are still reachable, whole (tools.ts `about`).
  assert(passage([one], true).includes(said), 'the notes are handed over')
})
