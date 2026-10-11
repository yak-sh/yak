// The vocabulary a configured Worker store speaks, plus an app's own declarations.
// Store facets own the words; the generated loader resolves those facets once.
import type { Derived } from '@yaks/sql'
import { refuse } from './tool.ts'
import { type Host, url } from './host.ts'
import {
  changed,
  type Keywords,
  metaDoc,
  type PropSchema,
  same,
  storable,
  typesOf,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { blobKeywords } from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { keyKeywords } from '@yaks/key'
import { floored, memberKeywords, permitted } from '@yaks/member'
import { idKeywords } from '@yaks/id'
import { derived as builds } from '@yaks/builders/vocab'
import { sessionDerived } from '@yaks/session/status'
import { read } from '@yaks/yaml'
import { docs as lensDocs } from '@yaks/lens/vocab'
import { declaredLenses, lensPaths, retainedLenses } from './lenses.ts'
import { configs } from './config.ts'
import { chosen, facetsOf, given, used } from '@yaks/host/config'
import {
  type Taken,
  type Words,
  wordsOf as composed,
  type WordsOpts,
} from '@yaks/host/words'
import { vocabFacets } from './load.ts'
export {
  appsDoc,
  classificationDoc,
  exceptionDoc,
  kernelDoc,
} from './facets/app-vocab.ts'
export { directoryDoc } from './facets/directory-vocab.ts'

/** The keyword vocabularies the stores have always understood. */
export let appKeywords: Keywords[] = [
  blobKeywords,
  edgeKeywords,
  keyKeywords,
  memberKeywords,
]
export let metaKeywords: Keywords[] = [idKeywords, ...appKeywords]
let appOptions: WordsOpts = { implicit: false, keywords: appKeywords }
let metaOptions: WordsOpts = { implicit: false, keywords: metaKeywords }
export type StoreKind = keyof typeof configs
let configured = Object.fromEntries(
  Object.entries(configs).map((
    [kind, config],
  ) => [
    kind,
    (config.plugins ?? []).flatMap((plug): Taken<'vocab'> => {
      let plugin = used(plug), facet = vocabFacets[plugin]
      if (!facet) throw new Error(`no vocabulary facet for ${plugin}`)
      return [[facet, given(plug), plugin, chosen(plug), facetsOf(plug)]]
    }),
  ]),
) as Record<StoreKind, Taken<'vocab'>>
/** The configured declarations, with an optional graph-owned vocabulary. */
export let storeWords = (kind: StoreKind, own?: VocabDoc[]): Words =>
  composed(configured[kind], own, kind == 'app' ? appOptions : metaOptions)

// Existing readers ask for a store's documents; these are projections of its
// configuration, shared with the assembly rather than maintained lists.
export let coreDocs = storeWords('app').docs
export let platformDocs = storeWords('directory').docs
export let gitDocs = storeWords('git').docs
export let platformVocab = (): Vocab => storeWords('directory').vocab
export let gitVocab = (): Vocab => storeWords('git').vocab
export let appDerived = (vocab: Vocab, reading: Derived = {}): Derived => ({
  ...sessionDerived(vocab, reading),
  ...builds(vocab),
})

/** The edge verbs the platform's stores understand. */
export let RELATIONS: string[] = coreDocs.flatMap((d) =>
  Object.entries(d.$defs ?? {}).filter(([, s]) => s.edge === true).map((
    [name],
  ) => name)
)
let shapeOf = (s: PropSchema): string =>
  s.enum ? s.enum.join('|') : String(s.type ?? '?')
export let PLATFORM_APART: string[] = platformDocs.flatMap((doc) =>
  Object.entries(doc.$defs ?? {})
)
  .flatMap(([name, mine]) => {
    let theirs = storeWords('app').vocab.def(name)?.properties
    return Object.entries(mine.properties ?? {}).filter(([prop, s]) =>
      theirs?.[prop] && shapeOf(theirs[prop]) != shapeOf(s)
    ).map(([prop]) => `${name}.${prop}`)
  })
export let componentsOf = (docs: VocabDoc[]): string[] =>
  docs.filter((d) => d.reserved !== false).flatMap((d) =>
    Object.entries(d.$defs ?? {}).filter(([, e]) =>
      e?.tool !== true && e?.lens !== true
    ).map(([name]) => name)
  )
export let RESERVED: string[] = [
  ...new Set(componentsOf([...coreDocs, ...platformDocs, ...gitDocs])),
].sort()
export let EXAMPLE =
  '{"$defs": {"recipe": {"properties": {"serves": {"type": "number"}}}}}'
export let GUIDE = url({}, '/docs.md')
export let teach = (env: Host = {}) =>
  ' — a component of your own is declared in vocab.json ' +
  'and planted by app_deploy: ' + `${EXAMPLE} · call guide with page ` +
  `components, or ${url(env, '/docs.md')}`

// The words that name a property's type, and the JSON Schema each is. A
// manifest writes the schema; these are for reading one back in a sentence — a
// refusal saying what a property already is, the types a CSV's cells are
// coerced to (csv.ts).
export type Word =
  | 'text'
  | 'number'
  | 'bool'
  | 'time'
  | 'url'
  | 'object'
  | 'array'
export let WORDS: Record<Word, PropSchema> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: { type: 'string', format: 'date-time' },
  url: { type: 'string', format: 'uri' },
  object: { type: 'object' },
  array: { type: 'array' },
}

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/** The word that names a declared property's type: the one its type and
 * format name, else the one its type alone names — a `priority` is a number,
 * and so is an `integer` — else `text`, which is what anything else stores as.
 * A union is its members' words, `number or text`, in one order however the
 * manifest listed them, and may hold `null` besides. */
export let wordOf = (s: PropSchema): string => {
  let types = typesOf(s)
  if (types.length > 1) {
    return [...new Set(types.map((type) => wordOf({ ...s, type })))].sort()
      .join(' or ')
  }
  let type = s.type == 'integer' ? 'number' : s.type
  let words = Object.entries(WORDS)
  let named =
    words.find(([, one]) => one.type == type && one.format == s.format) ??
      words.find(([, one]) => one.type == type && !one.format)
  return named?.[0] ?? (type == 'null' ? 'null' : 'text')
}

// Whether two declarations of one property store the same thing: the same JSON
// types, in any order, and the same format. A union is an array, so it is
// compared by what it holds.
/**
 * A document as `{comp: {prop: word}}` — every component's properties as the
 * word that names each one's type. That is how the kernel reads a
 * vocabulary where it needs the types and not the keywords (tools.ts `sheetOf`,
 * reach.ts `spoken`); the document itself is what a store keeps and answers.
 */
export let wordsOf = (doc: VocabDoc): Record<string, Record<string, string>> =>
  Object.fromEntries(
    Object.entries(doc.$defs ?? {}).map(([name, schema]) => [
      name,
      Object.fromEntries(
        Object.entries(schema.properties ?? {}).map((
          [prop, s],
        ) => [prop, wordOf(s)]),
      ),
    ]),
  )

/**
 * The manifest a store keeps after a deploy. A word the new manifest stopped
 * naming — a whole component, or one property of a component it still names —
 * leaves when nothing is stored under it, so the store holds one shape and not
 * the old one beside the new (M-17871); a word something is stored under stays
 * declared, because those values are the record of what it is. A type is held
 * the same way: a property whose type changed is refused while any row holds a
 * value there, because those values were written under the old type, and one
 * that holds nothing takes the new type. `rows` counts what a component holds,
 * or with a property, how many of its rows hold a value there — the store's
 * question, since only it has the tables.
 *
 * It also says what moved, because a rename is otherwise silent: the manifest
 * reads as one word while the store holds two until the old one's values have
 * moved (C-32652 item 4). `added` is every property this manifest planted, a
 * retyped one included; `kept` is every property the store still declares that
 * this manifest did not name; `dropped` is every component and `comp.prop`
 * that left; `retyped` is every empty `comp.prop` whose column the store sheds
 * so it stands again at its new type.
 */
export let grew = (
  was: VocabDoc,
  next: VocabDoc,
  rows: (name: string, prop?: string) => number = () => 1,
): ReturnType<typeof growing> =>
  growing(was, next, rows, (name, prop, had) => {
    if (rows(name, prop)) {
      throw refuse(
        'arguments',
        `vocab.json: ${name}.${prop} is already ${
          wordOf(had)
        } — a property keeps the type its rows were written under`,
      )
    }
  })

/** Accepted release declarations reconstructed without Store rows. Retired
 * words stay declared conservatively; a property explicitly declared by a
 * later accepted release takes that release's type. Admission belongs to
 * {@link grew}, when the Store can count the values a change would affect. */
export let retained = (was: VocabDoc, next: VocabDoc): VocabDoc =>
  growing(was, next, () => 1, () => {}).doc

let growing = (
  was: VocabDoc,
  next: VocabDoc,
  rows: (name: string, prop?: string) => number,
  retype: (name: string, prop: string, had: PropSchema) => void,
): {
  doc: VocabDoc
  dropped: string[]
  added: string[]
  kept: string[]
  retyped: string[]
} => {
  next = retainedLenses(was, next)
  let sources = declaredLenses(next) ? new Set(lensPaths(next)) : null
  let mine = was.$defs ?? {}
  let theirs = next.$defs ?? {}
  let delta = changed(was, next)
  // A whole view carries its retired membership in the lens declaration.
  // Property renames still need their source component's stored membership.
  let dropped = delta.dropped.filter((n) =>
    !n.includes('.') && !rows(n) &&
    ![...sources ?? []].some((p) => p.startsWith(`${n}.`))
  )
  let defs: Record<string, PropSchema> = { ...mine }
  let added: string[] = []
  let retyped: string[] = []
  for (let name of dropped) delete defs[name]
  for (let [name, schema] of Object.entries(theirs)) {
    if (schema.lens === true) {
      defs[name] = schema
      continue
    }
    let props: Record<string, PropSchema> = { ...mine[name]?.properties }
    for (let prop of Object.keys(props)) {
      if (
        !delta.dropped.includes(`${name}.${prop}`) || rows(name, prop)
      ) {
        continue
      }
      delete props[prop]
      dropped.push(`${name}.${prop}`)
    }
    for (let [prop, s] of Object.entries(schema.properties ?? {})) {
      let had = props[prop]
      if (had && delta.retyped.includes(`${name}.${prop}`)) {
        retype(name, prop, had)
        retyped.push(`${name}.${prop}`)
      }
      if (!had || !same(had, s)) added.push(`${name}.${prop}`)
      props[prop] = s
    }
    defs[name] = { ...schema, properties: props }
  }
  let kept = Object.entries(defs).flatMap(([name, s]) =>
    Object.keys(s.properties ?? {})
      .filter((prop) => !(prop in (theirs[name]?.properties ?? {})))
      .map((prop) => `${name}.${prop}`)
  )
  return { doc: { ...next, $defs: defs }, dropped, added, kept, retyped }
}

/**
 * Where each word of a space lives: the component schemas one app homes, by
 * name. Read off that app's `/vocab`, which answers only the words it homes —
 * so a use never looks like a second declaration (tools.ts `homesIn`).
 */
export type Homes = Record<
  string,
  { at: string; props: Record<string, PropSchema> }
>

/**
 * A manifest split by home. A word another app in the space already declares
 * is not a second declaration but a use (T-32728): nothing is planted here,
 * the writes route to the home store (reach.ts), and a property this manifest
 * adds grows the HOME's table by the additive rule {@link grew} holds every
 * store to.
 *
 * So a manifest arrives split three ways: `mine` the words this app homes,
 * `uses` the words it borrows and where each lives, and `grows` the properties
 * each home has to add. A property travels as its schema, never as its type
 * alone: `search` and every other keyword belong to the property, and the store
 * that plants it is the one that reads them (T-37546).
 *
 * The one refusal is a shape conflict — the same property with two types —
 * because the rows already written under the home's type are the record of
 * what that property is, and no manifest may rewrite them.
 */
export let homed = (next: VocabDoc, homes: Homes) => {
  let mine: Record<string, PropSchema> = {}
  let uses: Record<string, string> = {}
  let grows: Record<string, Record<string, Record<string, PropSchema>>> = {}
  for (let [name, schema] of Object.entries(next.$defs ?? {})) {
    let home = homes[name]
    if (!home) {
      mine[name] = schema
      continue
    }
    uses[name] = home.at
    let add: Record<string, PropSchema> = {}
    for (let [prop, s] of Object.entries(schema.properties ?? {})) {
      let had = home.props[prop]
      if (had && !same(had, s)) {
        throw refuse(
          'arguments',
          `vocab.json: ${name}.${prop} is ${wordOf(s)} here and ${
            wordOf(had)
          } in ${home.at}, where ${name} lives — a property keeps the type its ` +
            'rows were written under',
        )
      }
      if (!had) add[prop] = s
    }
    if (Object.keys(add).length) {
      grows[home.at] = { ...grows[home.at], [name]: add }
    }
  }
  return { mine: { ...next, $defs: mine }, uses, grows }
}

/**
 * What a deploy says about a word it uses from another app: where the
 * component lives, whether the caller is an agent, command or page.
 */
export let livesIn = (uses: Record<string, string>) =>
  Object.entries(uses).map(([name, at]) => `uses: ${name} from ${at}`)

/** One component an app declared. Its own word is the most specific thing said
 * about a row — an entity wearing `recipe` is a recipe, not the `doc` it also
 * wears for its title — so it is a kind sorting before `doc` unless the
 * manifest says otherwise, which is also what earns it its two tools
 * (kinds.ts). */
let mine = (schema: PropSchema): PropSchema =>
  schema.lens === true ? schema : ({
    // `component: true` is the marker @yaks/vocab wants on a component, and it
    // is put on here rather than asked of the person: an app manifest's $defs
    // entries are its components, save the ones marked `tool: true`, and a store
    // that accepted one before the marker existed reads back the same way
    // (T-37551).
    component: true,
    type: 'object',
    kind: true,
    before: ['doc'],
    ...schema,
  })

/**
 * The manifest words that open a spend to the app's visitors, each with what
 * it lets them do: `"open"` lets anyone who may write the app do it, where only
 * its members may otherwise. `models` is asking the app's models (graph.ts
 * `FLOORS`, D-40545); `rtc` is its voice door (rtc.ts, D-40615).
 */
export let OPENS: Record<string, string> = {
  models: 'ask its models',
  rtc: 'speak and listen through its voice door',
}

/**
 * An app's `vocab.json` as one document: a JSON Schema 2020-12 document with
 * `$defs`, which is the one form a manifest is written in. A manifest of
 * bare component names declares no `$` keyword, and is refused in a sentence
 * naming the shape.
 *
 * It is checked here rather than at the load: anything a property cannot hold
 * is refused. A name the platform already says is {@link unsaid}'s to refuse,
 * at the doors a new manifest comes through, because this one also reads what
 * a store already holds.
 *
 * `file` is what a refusal calls it — the app may have written it as `.json` or
 * `.yml` (tools.ts `spelled`), and the sentence has to name the file they are
 * looking at.
 *
 * `"tools": false`, `"models": "open"` and `"rtc": "open"` are the words a
 * manifest says about itself rather than about a component, so each is lifted
 * off and carried on the document. `tools: false` synthesizes no tools for its
 * kinds (kinds.ts, T-34513); a boolean tells it from a component named
 * `tools`, which is an object of properties like any other. The other two are
 * each {@link OPENS}: who may spend the owner's account budget through the app.
 *
 * A `$defs` entry marked `"tool": true` is one of the app's commands, not a
 * component: it is left out here and read by @yaks/tools/declared `parseTools`, so a
 * store's vocabulary holds components alone.
 */
export let appDoc = (source: unknown, file = 'vocab.json'): VocabDoc => {
  let held = source
  if (typeof held == 'string') {
    try {
      held = held.trim() ? read(held, file) : {}
    } catch (e) {
      throw refuse('arguments', `${(e as Error).message} — ${EXAMPLE}`)
    }
  }
  if (held == null) held = {}
  if (!object(held)) {
    throw refuse('arguments', `${file} is an object — ${EXAMPLE}`)
  }
  let off = typeof held.tools == 'boolean' ? held.tools : undefined
  let opens = Object.entries(OPENS).filter(([word]) => held[word] !== undefined)
  for (let [word, act] of opens) {
    let said = held[word]
    if (said !== 'open' && said !== 'members') {
      throw refuse(
        'arguments',
        `${file}: "${word}" is "open" (anyone who may write this app may ` +
          `${act}) or "members" (only its members may, which is what ` +
          `leaving it out says)`,
      )
    }
  }
  let body = Object.fromEntries(
    Object.entries(held).filter(([k]) =>
      !(k == 'tools' && off !== undefined) && !(k in OPENS)
    ),
  )
  let keys = Object.keys(body)
  if (keys.length && !keys.some((k) => k.startsWith('$'))) {
    throw refuse(
      'arguments',
      `${file}: ${keys.join(', ')} — a manifest is a JSON Schema document, ` +
        `one $defs entry per component and one properties entry per property: ` +
        `${EXAMPLE}; the whole of it is in the guide under ` +
        `"Components of your own" (${GUIDE})`,
    )
  }
  let doc = body as VocabDoc
  if (doc.$defs) {
    doc = {
      ...doc,
      $defs: Object.fromEntries(
        Object.entries(doc.$defs)
          .filter(([, s]) => s?.tool !== true)
          .map(([name, s]) => [name, mine(s)]),
      ),
    }
  }
  if (off !== undefined) doc = { ...doc, tools: off }
  for (let [word] of opens) doc = { ...doc, [word]: held[word] }
  let errs = [...storable(doc), ...floored(doc)]
  if (errs.length) throw refuse('arguments', `${file}: ${errs.join('; ')}`)
  // A companion can be supplied by the platform, so resolve permission names
  // in the same composed vocabulary the store will hold.
  if (Object.values(doc.$defs ?? {}).some((s) => s.permit !== undefined)) {
    let errors = permitted(storeWords('app', [doc]).vocab)
    if (errors.length) {
      throw refuse('arguments', `${file}: ${errors.join('; ')}`)
    }
  }
  return doc
}

/**
 * A new manifest, refused if it declares a word the platform already says
 * ({@link RESERVED}) — all of them at once, before anything is planted: a
 * manifest refused one name at a time is probed one deploy at a time, and every
 * probe that got through left a component behind for good (C-32624 item 1).
 * The sentence is the one the guide prints under "The names already taken",
 * and it says where the whole list is, because the agent reading it has no
 * other source.
 *
 * `held` is what the app's store declares already, and a word it holds stays
 * the app's: the list moves whenever the platform's vocabularies do, and an app
 * that declared a word before the platform said it keeps deploying it. A
 * stored manifest is never held to this, so a store wakes whatever the list
 * has become since.
 * `accepted` names the words of an immutable release already admitted by the
 * platform. Installing, updating or restoring it inherits those words even
 * where this store has never held them.
 */
export let unsaid = (
  doc: VocabDoc,
  held: VocabDoc = {},
  file = 'vocab.json',
  accepted: string[] = [],
): VocabDoc => {
  let taken = Object.keys(doc.$defs ?? {})
    .filter((n) =>
      RESERVED.includes(n) && !(n in (held.$defs ?? {})) &&
      !accepted.includes(n)
    )
  if (taken.length) {
    throw refuse(
      'arguments',
      `${file}: ${taken.join(', ')} ${
        taken.length == 1 ? 'is a word' : 'are words'
      } the platform already says — pick another name; the whole list is in ` +
        `the guide under "Components of your own" (${GUIDE})`,
    )
  }
  return doc
}

/**
 * What a store's `/vocab` answered, as the document it means — and an empty
 * document where it cannot be read at all. A door reading a vocabulary is
 * reading it to say something else (which words are in reach, which kinds an
 * app holds, what a batch may write), so one store with an answer nothing can
 * parse reads as an app with no words of its own rather than a failed request.
 * {@link appDoc} is the door a deploy comes through, where a refusal is the
 * whole point.
 */
export let meant = (said: unknown): VocabDoc => {
  try {
    return appDoc(said)
  } catch {
    return {}
  }
}

/**
 * The core documents under an app's own words: each word the app declares is
 * left out of them, so in its store the app's word is the one home.
 *
 * Every door a new manifest comes through refuses a platform word
 * ({@link unsaid}), so an app declares one only where it held the word before
 * the platform said it. The app's word stays what its rows were written under,
 * and what the platform means by the name is absent from that one store: a
 * reader of it asks the vocabulary for what it reads (`cost.dollars`), never
 * for the name alone.
 */
/**
 * One app's whole vocabulary: the core documents plus its own `vocab.json`,
 * loaded into the `Vocab` a Store reads its DDL, routing and admission out of.
 * The source is the file as written — text or already parsed — and an app that
 * declares nothing gets the core alone. A word the app declares is its own
 * even where the core says it too ({@link beneath}).
 *
 * A vocabulary never changes once loaded, and the core it is built on dwarfs an
 * app's own words, so it is loaded once per declaration and shared: every app
 * that declares nothing, the same `vocab.json` deployed again, and the two
 * declarations a deploy diffs (graph.ts `#prepared`, the `/vocab` door) all
 * read one loaded vocabulary. Keyed by the validated declaration, so a bad one
 * still refuses ({@link appDoc}) and is never kept.
 */
let appVocabs = new Map<string, Words>()
export let appWords = (source: unknown = {}): Words => {
  let doc = appDoc(source)
  let key = JSON.stringify(doc)
  let held = appVocabs.get(key)
  if (held) {
    appVocabs.delete(key)
    appVocabs.set(key, held)
    return held
  }
  let v = storeWords('app', [
    metaDoc,
    ...(declaredLenses(doc) ? lensDocs : []),
    doc,
  ])
  appVocabs.set(key, v)
  if (appVocabs.size > 64) appVocabs.delete(appVocabs.keys().next().value!)
  return v
}
export let appVocab = (source: unknown = {}): Vocab => appWords(source).vocab

/**
 * Whether this store numbers its entities, read off the vocabulary it woke
 * with: @yaks/id's document is the one place `entity.num` is declared, so a
 * store that loaded it has numbers and one that did not has none. The storage
 * adapter is told this (graph.ts), so there is one answer rather than a
 * vocabulary saying one thing and the writer doing another.
 */
export let numbered = (v: Vocab): boolean => !!v.prop('entity', 'num')
