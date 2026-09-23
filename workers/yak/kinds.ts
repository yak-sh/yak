// The commands a kind is worth (T-34513). An app that declares a `recipe` in
// its vocab.json gets `add_recipe` and `find_recipe` for nothing, so the next
// agent the person talks to — one that has never read this app's pages —
// discovers there is somewhere to put a recipe the way it discovers anything
// else here: by asking `commands` what the apps in reach can do.
//
// Nothing new answers them. They are ordinary declared tools (lib/tools.ts
// ToolDef), planted in the app's store beside whatever its tools.json said and
// listed, called, titled and described through the one seam (declared.ts) — so
// `readOnly` on the find and the app's title and address on the description
// come for free.
//
// The two ways out, in the order they are asked:
//   "tools": false   at the top of vocab.json — this app wants none of them
//   a tools.json entry naming `add_recipe` or `find_recipe` — that one wins,
//                    whole, since a hand-written template says what the app
//                    means and a generated one only says what it holds
// A redeploy regenerates them from the manifest as it then reads, so a property
// added to a kind is an argument added to its two tools.
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import type { ToolDef, Tools } from './lib/tools.ts'
import { type Word, wordOf } from './vocab.ts'

// The properties a caller may write: a server-owned property is nobody's to
// send, and a computed one has no column at all.
let propsOf = (schema: PropSchema): Record<string, Word> =>
  Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([, s]) => !s.stamped && s.computed !== true)
      .map(([prop, s]) => [prop, wordOf(s) as Word]),
  )

// Enough English for a sentence a model reads: a `recipe` finds recipes, a
// `dish` finds dishes, a `story` finds stories.
let plural = (word: string) =>
  /(s|x|z|ch|sh)$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : `${word}s`

// What the vocabulary says the kind IS, as the tail of a sentence. A component
// that declared no `description` says nothing, and the sentence stops early
// rather than inventing a meaning the app never claimed. No full stop: the door
// appends the app's title and address to every declared tool's sentence
// (declared.ts), and that reads as one line.
let means = (schema: PropSchema) =>
  schema.description ? `: ${schema.description.replace(/\.$/, '')}` : ''

let bound = (props: Record<string, Word>) =>
  Object.fromEntries(Object.keys(props).map((prop) => [prop, `$${prop}`]))

// Writing one: a title, a body, a name to find it by later, and the kind's own
// properties. Only the title is required — an agent writes what it was told and
// leaves the rest of the row empty, the way the app's own form does, and a
// property nobody named is dropped from the bundle rather than written as the
// word `undefined` (lib/tools.ts `filled`).
//
// A kind declaring a property `title` or `body` of its own shares the variable
// with `doc`: one argument, written both places, which is what a person asking
// for "the title" means either way.
let add = (kind: string, at: string, schema: PropSchema): ToolDef => {
  let props = propsOf(schema)
  return {
    description: `Add a ${kind} to ${at}${means(schema)}`,
    input: { title: 'text', body: 'text', alias: 'text', ...props },
    optional: ['body', 'alias', ...Object.keys(props)],
    // The kind's own component stays even when nobody named a property —
    // wearing it is what makes the row a recipe, and `find_recipe` asks for
    // exactly that. A nameless alias is the other way: half a sentence, refused
    // by
    // @yaks/key, so it goes with its variable.
    drop: ['alias'],
    apply: {
      entity: { eid: `$${kind}` },
      doc: { title: '$title', body: '$body' },
      // A name the row answers to afterwards (@yaks/alias), so a later call
      // reaches it without having kept the eid.
      alias: { name: '$alias' },
      [kind]: bound(props),
    },
  }
}

// Reading them back: the words for the title and body, an equality for every
// property, and how many. Every one is optional, and a clause whose argument
// the caller left out drops out of the filter line — so the tool with no
// arguments at all is "everything of this kind".
let find = (kind: string, at: string, schema: PropSchema): ToolDef => {
  let props = propsOf(schema)
  return {
    description: `Find ${plural(kind)} in ${at}${means(schema)}. Words match ` +
      'the title and body; leave out any filter you do not have',
    input: { words: 'text', ...props, limit: 'number' },
    optional: ['words', ...Object.keys(props), 'limit'],
    query: [
      `.${kind}!`,
      '.doc?',
      '$words',
      ...Object.keys(props).map((prop) => `.${kind}.${prop}=$${prop}`),
      'limit=$limit',
    ].join('&'),
  }
}

/**
 * An app's declared tools with the ones its kinds are worth beside them: what a
 * deploy hands the store. The app's own entries come first and keep their
 * names — a tools.json entry naming `add_recipe` is the `add_recipe` this app
 * has.
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
