// The commands a kind is worth (T-34513). An app that declares a `recipe` in
// its vocab.json gets `add_recipe` and `find_recipe` for nothing, so the next
// agent the person talks to — one that has never read this app's pages —
// discovers there is somewhere to put a recipe the way it discovers anything
// else here: by asking `commands` what the apps in reach can do.
//
// A kind is what @yaks/vocab reads it as (its kinds.ts): a manifest's `kinds`
// entries, or, in a manifest that declares none, each of its components. So
// `add_<kind>` writes the kind's shape: its `is` components and each `with`
// component the writer supplies, with `doc` and `alias`. A `with` component
// that carries values is the rule's to add, which it does inside the same
// write (@yaks/vocab rules.ts).
//
// Nothing new answers them. They are ordinary declared tools (@yaks/tools/declared
// ToolDef), planted in the app's store beside the ones its vocab.json declares
// and listed, called, titled and described through the one seam (declared.ts) — so
// `readOnly` on the find and the app's title and address on the description
// come for free.
//
// The two ways out, in the order they are asked:
//   "tools": false   at the top of vocab.json — this app wants none of them
//   a tool of its own named `add_recipe` or `find_recipe` — that one wins,
//                    whole, since a hand-written template says what the app
//                    means and a generated one only says what it holds
// A redeploy regenerates them from the manifest as it then reads, so a property
// added to a kind is an argument added to its two tools.
import {
  jsonb,
  type Kind,
  kindsIn,
  type PropSchema,
  type VocabDoc,
} from '@yaks/vocab'
import type { Arg, ToolDef, Tools } from '@yaks/tools/declared'

// What an argument takes from the property it fills: the type the column
// holds, what an object or a list holds, and the words saying what it is.
// Nothing else rides across — a property's `default` is what a row gets when
// nobody wrote it, and as an argument's it would put a filter in every find the
// caller never asked for.
let ARG = ['type', 'format', 'enum', 'items', 'properties', 'description']

let argOf = (s: PropSchema): Arg =>
  Object.fromEntries(
    ARG.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]),
  )

let TEXT: Arg = { type: 'string' }

// The properties a caller may write: a server-owned property is nobody's to
// send, and a computed one has no column at all.
let propsOf = (schema: PropSchema): Record<string, PropSchema> =>
  Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([, s]) => !s.stamped && s.computed !== true),
  )

// Enough English for a sentence a model reads: a `recipe` finds recipes, a
// `dish` finds dishes, a `story` finds stories.
let plural = (word: string) =>
  /(s|x|z|ch|sh)$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : `${word}s`

// "a recipe", "an official": the article a kind's name takes.
let article = (word: string) => /^[aeiou]/.test(word) ? 'an' : 'a'

// What the vocabulary says the kind IS, as the tail of a sentence. A kind
// that declared no `description` says nothing, and the sentence stops early
// rather than inventing a meaning the app never claimed. No full stop: the door
// appends the app's title and address to every declared tool's sentence
// (declared.ts), and that reads as one line.
let means = (kind: Kind) =>
  kind.description ? `: ${kind.description.replace(/\.$/, '')}` : ''

/** The kinds an app's manifest declares, as @yaks/vocab reads them: its
 * `kinds` entries, and each component that is the kind of its own name. */
export let kindsOf = (doc: VocabDoc): Kind[] => [
  ...kindsIn([doc], doc.$defs ?? {}, {}).values(),
]

// The components a writer of one names, past the `doc` and `alias` every add
// writes: its `is` components, then each `with` one the writer supplies.
let written = (kind: Kind) =>
  [
    ...new Set([
      ...kind.is,
      ...Object.keys(kind.with).filter((c) => kind.with[c] === true),
    ]),
  ].filter((c) => c != 'doc' && c != 'alias')

// Each written component's properties, by the argument that fills them. A
// property only one of them has is the argument of its own name; one several
// share is `<component>_<property>` for each, since `at` on an event and `at`
// on its venue are two things to say. A component the manifest does not
// declare has no properties to offer here, and is written empty.
type Slot = { comp: string; prop: string; schema: PropSchema }
let slotsOf = (
  kind: Kind,
  defs: Record<string, PropSchema>,
): Record<string, Slot> => {
  let all = written(kind).flatMap((comp) =>
    Object.entries(propsOf(defs[comp] ?? {})).map(([prop, schema]) => ({
      comp,
      prop,
      schema,
    }))
  )
  let shared = (prop: string) => all.filter((s) => s.prop == prop).length > 1
  return Object.fromEntries(
    all.map((s) => [shared(s.prop) ? `${s.comp}_${s.prop}` : s.prop, s]),
  )
}

let args = (slots: Record<string, Slot>) =>
  Object.fromEntries(
    Object.entries(slots).map(([name, s]) => [name, argOf(s.schema)]),
  )

// Writing one: a title, a body, a name to find it by later, and the properties
// of the components it is. Only the title is required — an agent writes what
// it was told and leaves the rest of the row empty, the way the app's own form
// does, and a property nobody named is dropped from the bundle rather than
// written as the word `undefined` (@yaks/tools/declared `filled`).
//
// A kind declaring a property `title` or `body` of its own shares the variable
// with `doc`: one argument, written both places, which is what a person asking
// for "the title" means either way.
let add = (
  kind: Kind,
  at: string,
  defs: Record<string, PropSchema>,
): ToolDef => {
  let slots = slotsOf(kind, defs)
  let bound = (comp: string) =>
    Object.fromEntries(
      Object.entries(slots).filter(([, s]) => s.comp == comp)
        .map(([name, s]) => [s.prop, `$${name}`]),
    )
  return {
    description: `Add ${article(kind.name)} ${kind.name} to ${at}${
      means(kind)
    }`,
    input: { title: TEXT, body: TEXT, alias: TEXT, ...args(slots) },
    required: ['title'],
    // The kind's components stay even when nobody named a property — wearing
    // them is what makes the row a recipe, and `find_recipe` asks for exactly
    // that. A nameless alias is the other way: half a sentence, refused by
    // @yaks/key, so it goes with its variable.
    drop: ['alias'],
    apply: {
      entity: { eid: `$${kind.name}` },
      doc: { title: '$title', body: '$body' },
      // A name the row answers to afterwards (@yaks/alias), so a later call
      // reaches it without having kept the eid.
      alias: { name: '$alias' },
      ...Object.fromEntries(written(kind).map((c) => [c, bound(c)])),
    },
  }
}

// Reading them back: the words for the title and body, an equality for every
// property, and how many. Every one is optional, and a clause whose argument
// the caller left out drops out of the filter line — so the tool with no
// arguments at all is "everything of this kind". A property holding a JSON
// value is no argument here: a filter asks only whether one is there.
let find = (
  kind: Kind,
  at: string,
  defs: Record<string, PropSchema>,
): ToolDef => {
  let slots = Object.fromEntries(
    Object.entries(slotsOf(kind, defs)).filter(([, s]) => !jsonb(s.schema)),
  )
  return {
    description: `Find ${plural(kind.name)} in ${at}${means(kind)}. Words ` +
      'match the title and body; leave out any filter you do not have',
    input: { words: TEXT, ...args(slots), limit: { type: 'number' } },
    query: [
      ...kind.is.map((c) => `.${c}`),
      '?doc',
      '$words',
      ...Object.entries(slots).map(([name, s]) =>
        `.${s.comp}.${s.prop}=$${name}`
      ),
      'limit=$limit',
    ].join('&'),
  }
}

/**
 * A manifest's kinds, one line each as an agent reads them at a glance: the
 * kind, the components it is and the ones its writer also supplies, then the
 * ones a rule adds. `props` names the properties of a component the manifest
 * does not declare itself, such as the platform's `doc`.
 */
/// index({ $defs: { recipe: { kind: true, properties: { serves: {} } } } })
///   -> ['recipe: recipe{serves}']
export let index = (
  doc: VocabDoc,
  props: (comp: string) => string[] | undefined = () => undefined,
): string[] => {
  let defs = doc.$defs ?? {}
  let say = (c: string) => {
    let has = defs[c] ? Object.keys(defs[c].properties ?? {}) : props(c)
    return has ? `${c}{${has.join(', ')}}` : c
  }
  return kindsOf(doc).map((k) => {
    let carried = Object.keys(k.with)
    let ruled = carried.filter((c) => k.with[c] !== true)
    let parts = [...k.is, ...carried.filter((c) => k.with[c] === true)]
    return `${k.name}: ${parts.map(say).join(', ')}${
      ruled.length ? `; a rule adds ${ruled.map(say).join(', ')}` : ''
    }`
  })
}

/**
 * Whether a command is one {@link withKinds} made rather than one the app
 * declared: its name is a kind's, and so is the start of its sentence, which
 * a hand-written `add_recipe` says in its own words. The Operator's map names
 * only the declared ones, since what an app holds already says it has these.
 */
export let generated = (
  name: string,
  tool: Pick<ToolDef, 'description'>,
): boolean => {
  let [, verb, kind] = /^(add|find)_([a-z0-9_]+)$/.exec(name) ?? []
  // "an?": a release kept from before the article was right says "Add a".
  let made = verb == 'add' ? `Add an? ${kind} to ` : `Find ${plural(kind)} in `
  return !!kind && new RegExp(`^${made}`).test(tool.description)
}

/**
 * An app's declared tools with the ones its kinds are worth beside them: what a
 * deploy hands the store. The app's own entries come first and keep their
 * names — a tool of its own named `add_recipe` is the `add_recipe` this app
 * has.
 */
export let withKinds = (tools: Tools, doc: VocabDoc, at: string): Tools => {
  if (doc.tools === false) return tools
  let defs = doc.$defs ?? {}
  let out: Tools = { ...tools }
  for (let kind of kindsOf(doc)) {
    let pair: [string, ToolDef][] = [
      [`add_${kind.name}`, add(kind, at, defs)],
      [`find_${kind.name}`, find(kind, at, defs)],
    ]
    for (let [name, def] of pair) if (!(name in out)) out[name] = def
  }
  return out
}
