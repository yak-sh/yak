// The tools a KIND is worth (T-34513). An app that declares a `recipe` in its
// vocab.json gets `recipes__add_recipe` and `recipes__find_recipe` at the agent
// door for nothing, so the next agent the person talks to — one that has never
// read this app's pages — discovers there is somewhere to put a recipe the way
// it discovers anything else here: by reading the tool list.
//
// Nothing new answers them. They are ordinary declared tools (src/store/tools.ts
// ToolDef), planted in the app's store beside whatever its tools.json said and
// listed, called, titled, hinted and told-about through the one seam
// (declared.ts) — so `readOnly` on the find, the app's title and address on the
// description, `_meta.securitySchemes`, and the `list_changed` a moved list
// sends all come for free.
//
// The two ways out, in the order they are asked:
//   "tools": false   at the top of vocab.json — this app wants none of them
//   a tools.json entry spelling `add_recipe` or `find_recipe` — that one wins,
//                    whole, since a hand-written template says what the app
//                    MEANS and a generated one only says what it holds
// A redeploy regenerates them from the manifest as it then reads, so a column
// added to a kind is an argument added to its two tools.
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import type { PropType } from '../../src/types.ts'
import type { ToolDef, Tools } from '../../src/store/tools.ts'
import { wordOf } from './vocab.ts'

// The columns a caller may WRITE: a server-owned column is nobody's to send,
// and a computed one has no column at all.
let colsOf = (schema: PropSchema): Record<string, PropType> =>
  Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([, s]) => !s.stamped && s.persist !== false)
      .map(([col, s]) => [col, wordOf(s) as PropType]),
  )

// Enough English for a sentence a model reads: a `recipe` finds recipes, a
// `dish` finds dishes, a `story` finds stories.
let plural = (word: string) =>
  /(s|x|z|ch|sh)$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : `${word}s`

// What the vocabulary says the kind IS, as the tail of a sentence. A manifest
// in the five-scalar short form says nothing, and the sentence stops early
// rather than inventing a meaning the app never claimed. No full stop: the door
// appends the app's title and address to every declared tool's sentence
// (declared.ts), and that reads as one line.
let means = (schema: PropSchema) =>
  schema.description ? `: ${schema.description.replace(/\.$/, '')}` : ''

let holes = (cols: Record<string, PropType>) =>
  Object.fromEntries(Object.keys(cols).map((col) => [col, `{{${col}}}`]))

// Writing one: a title, a body, a name to find it by later, and the kind's own
// columns. Only the title is required — an agent writes what it was told and
// leaves the rest of the row empty, the way the app's own form does, and a
// column nobody named is dropped from the bundle rather than written as the
// word `undefined` (store/tools.ts `filled`).
//
// A kind spelling a column `title` or `body` of its own shares the hole with
// `doc`: one argument, written both places, which is what a person asking for
// "the title" means either way.
let add = (kind: string, at: string, schema: PropSchema): ToolDef => {
  let cols = colsOf(schema)
  return {
    description: `Add a ${kind} to ${at}${means(schema)}`,
    input: { title: 'text', body: 'text', alias: 'text', ...cols },
    optional: ['body', 'alias', ...Object.keys(cols)],
    // The kind's own component stays even when nobody named a column — wearing
    // it is what makes the row a recipe, and `find_recipe` asks for exactly
    // that. A nameless alias is the other way: half a sentence, refused by
    // @yaks/key, so it goes with its hole.
    drop: ['alias'],
    apply: {
      entity: { eid: `$${kind}` },
      doc: { title: '{{title}}', body: '{{body}}' },
      // A name the row answers to afterwards (@yaks/alias), so a later call
      // reaches it without having kept the eid.
      alias: { name: '{{alias}}' },
      [kind]: holes(cols),
    },
  }
}

// Reading them back: the words for the title and body, an equality for every
// column, and how many. Every one is optional, and a clause whose argument the
// caller left out drops out of the filter line — so the tool with no arguments
// at all is "everything of this kind".
let find = (kind: string, at: string, schema: PropSchema): ToolDef => {
  let cols = colsOf(schema)
  return {
    description: `Find ${plural(kind)} in ${at}${means(schema)}. Words match ` +
      'the title and body; leave out any filter you do not have',
    input: { words: 'text', ...cols, limit: 'number' },
    optional: ['words', ...Object.keys(cols), 'limit'],
    query: [
      `.${kind}!`,
      '.doc?',
      '{{words}}',
      ...Object.keys(cols).map((col) => `.${kind}.${col}={{${col}}}`),
      'limit={{limit}}',
    ].join('&'),
  }
}

/**
 * An app's declared tools with the ones its kinds are worth beside them: what a
 * deploy hands the store. The app's own entries come first and keep their
 * names — a tools.json spelling `add_recipe` is the `add_recipe` this app has.
 */
export let withKinds = (tools: Tools, doc: VocabDoc, at: string): Tools => {
  if (doc.tools === false) return tools
  let out: Tools = { ...tools }
  for (let [kind, schema] of Object.entries(doc.$defs ?? {})) {
    if (!schema.kind) continue
    let pair: [string, ToolDef][] = [
      [`add_${kind}`, add(kind, at, schema)],
      [`find_${kind}`, find(kind, at, schema)],
    ]
    for (let [name, def] of pair) if (!(name in out)) out[name] = def
  }
  return out
}
