// The vocabulary a configured Worker store speaks, plus an app's own declarations.
// Store facets own the words; the generated loader resolves those facets once.
import type { Derived } from '@yaks/sql'
import { refuse } from './tool.ts'
import { type Host, url } from '@yaks/platform/host'
import {
  changed,
  kept as durableValue,
  type Keywords,
  type KindDecl,
  metaDoc,
  ms,
  type PropSchema,
  said as syncValue,
  same,
  typesOf,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { blobKeywords } from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { keyKeywords } from '@yaks/key'
import { memberKeywords } from '@yaks/member'
import { idKeywords, prefixes } from '@yaks/id'
import type { Series } from '@yaks/graph/storage'
import { derived as builds } from '@yaks/builders/vocab'
import { sessionDerived } from '@yaks/session/status'
import {
  declaredLenses,
  lensPaths,
  retainedLenses,
} from '@yaks/platform/lenses'
import { worker } from './config.ts'
import { vocabsOf } from './vocabs.ts'
import {
  type Taken,
  type Words,
  wordsOf as composed,
  type WordsOpts,
} from '@yaks/host/words'
import { selected } from '@yaks/host/documents'
import { dependencies, Unplanned } from '@yaks/esbuild'
import { vocabFacets } from './load.ts'
import { once } from '@yaks/fp'
import {
  appDocs,
  EXAMPLE,
  GUIDE,
  manifest,
  owned,
  owns,
} from '@yaks/platform/manifest'
export {
  appsDoc,
  classificationDoc,
  exceptionDoc,
  kernelDoc,
} from '@yaks/platform/app-vocab'
export { directoryDoc } from '@yaks/platform/directory-vocab'

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
export type StoreKind = keyof typeof worker.stores
let configured = Object.fromEntries(
  Object.entries(worker.stores).map(([kind, config]) => [
    kind,
    vocabsOf(config, vocabFacets),
  ]),
) as Record<StoreKind, Taken<'vocab'>>
/** The configured declarations, with an optional graph-owned vocabulary. */
export let storeWords = (kind: StoreKind, own?: VocabDoc[]): Words =>
  composed(configured[kind], own, kind == 'app' ? appOptions : metaOptions)

/** The packages an app's declaration names as its `"platform"` dependencies
 * (`stated`, from its package.json). */
export let packagesOf = (doc: VocabDoc): string[] =>
  Array.isArray(doc.packages) ? doc.packages : []

// Every name an app store speaks before its own words and its dependencies':
// the configured packages' and the meta vocabulary.
let everywhere = once(() =>
  new Set(
    storeWords('app', [metaDoc]).docs.flatMap((d) =>
      Object.keys(d.$defs ?? {})
    ),
  )
)
// The components a package's `./vocab` lends a store: the ones a store keeps.
// A page-only one (`sync: none`) never reaches a store, and a page composes it
// itself (@yaks/ux `kitDocs`); a `_` one is a store's own machinery (its
// journal, its lenses), which the platform turns on; and a package's tools,
// rules and effects stay with the processes its configuration binds.
let entriesOf = (pkg: string) =>
  (vocabFacets[pkg]?.docs ?? []).flatMap((d) => Object.entries(d.$defs ?? {}))
    .filter(([name, s]) =>
      s?.component === true && s.sync != 'none' && !name.startsWith('_')
    )

/**
 * What an app's `"platform"` dependencies add to its store, as the configured
 * packages are added (`configured`): each package's `./vocab` components, less
 * every name the store already speaks (`mine` names the app's own). A
 * dependency adds words and never changes one: an extension stays only where
 * it extends a word one of these packages lends. A package with no `./vocab`
 * lends nothing.
 */
export let lent = (
  packages: string[],
  mine: Iterable<string> = [],
): Taken<'vocab'> => {
  if (!packages.length) return []
  let held = new Set([...everywhere(), ...mine])
  let lending = new Set(
    packages.flatMap((pkg) =>
      entriesOf(pkg).filter(([name, s]) =>
        s?.extends !== true && !held.has(name)
      ).map(([name]) => name)
    ),
  )
  return packages.flatMap((pkg): Taken<'vocab'> => {
    let names = entriesOf(pkg).filter(([name, s]) =>
      s?.extends === true ? lending.has(name) : !held.has(name)
    ).map(([name]) => name)
    return names.length
      ? [[vocabFacets[pkg], {}, pkg, [...new Set(names)], ['vocab']]]
      : []
  })
}
// The names an app's own manifest declares, which no dependency lends again.
let declares = (doc: VocabDoc) =>
  Object.entries(doc.$defs ?? {}).filter(([, s]) => s?.extends !== true)
    .map(([name]) => name)
let pluginsOf = (doc: VocabDoc): Taken<'vocab'> => [
  ...configured.app,
  ...lent(packagesOf(doc), declares(doc)),
]
/** The documents an app's dependencies lend its store, as {@link lent} picks
 * them: for a reader composing the words of several apps at once. */
export let lentDocs = (doc: VocabDoc): VocabDoc[] =>
  lent(packagesOf(doc), declares(doc)).flatMap(([v, , pkg, names]) =>
    selected(v.docs ?? [], names, pkg).map((d) => ({ ...d, package: pkg }))
  )

// Existing readers ask for a store's documents; these are projections of its
// configuration, shared with the assembly rather than maintained lists. Each is
// composed when first asked for and kept for the isolate (storeWords), so a
// cold start composes no vocabulary its request never reads (T-37974).
export let coreDocs = () => storeWords('app').docs
export let platformDocs = () => storeWords('directory').docs
export let gitDocs = () => storeWords('git').docs
export let platformVocab = (): Vocab => storeWords('directory').vocab
export let gitVocab = (): Vocab => storeWords('git').vocab
export let appDerived = (vocab: Vocab, reading: Derived = {}): Derived => ({
  ...sessionDerived(vocab, reading),
  ...builds(vocab),
})

// A manifest's components: its $defs, save its commands and its lens steps.
let components = (doc: VocabDoc) =>
  Object.entries(doc.$defs ?? {}).filter(([, e]) =>
    e?.tool !== true && e?.lens !== true
  )

export let componentsOf = (docs: VocabDoc[]): string[] =>
  docs.filter((d) => d.reserved !== false).flatMap((d) =>
    components(d).map(([name]) => name)
  )
/** Every word the platform says, sorted: a new manifest declares none. */
export let reserved = once((): string[] =>
  [
    ...new Set(componentsOf([...coreDocs(), ...platformDocs(), ...gitDocs()])),
  ].sort()
)
// The most of an app's own components a refusal lists.
let OWN = 12
/** Where a word of the caller's own comes from, ending a refusal of one the
 * app's store does not speak. `own` is what the app's vocab.json declares,
 * said when there are few enough to read at a glance. An app never deployed
 * (`released` false) holds none of its words yet, whatever its draft
 * declares: app_deploy installs them. */
export let teach = (env: Host = {}, own?: string[], released = true) =>
  (released
    ? " — the app's vocab.json does not declare it" +
      (own && own.length <= OWN
        ? own.length
          ? ` (it declares ${own.map((c) => `.${c}`).join(', ')})`
          : ' (it declares no components yet)'
        : '') +
      `. Declare it there, like ${EXAMPLE}, and deploy the app with ` +
      'app_deploy to install it'
    : ' — the app has not been deployed yet, so none of the words its ' +
      'vocab.json declares are installed: app_deploy installs them. A word ' +
      `the draft's vocab.json does not declare yet is declared there first, ` +
      `like ${EXAMPLE}`) +
  ` · how to declare one: call guide with page components, or ${
    url(env, '/docs.md')
  }`

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
 * @yaks/reach `spoken`); the document itself is what a store keeps and answers.
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
 *
 * A `"platform"` dependency ({@link lent}) is held the same way: one the
 * manifest stopped naming stays while a component it lent holds rows, and its
 * empty components are `dropped` when it leaves.
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
        } — a property keeps the type its rows were written under, so ` +
          `declare it as ${wordOf(had)} again, or give the new type a ` +
          'property name of its own beside it',
      )
    }
  })

/**
 * `main` with every word `others` add to it: each component it lacks, and
 * each property a component it has lacks, as the other declares it. A word
 * `main` declares keeps its own declaration. What a store's schema holds
 * beside its own words, for the words its branches speak (graph.ts
 * `#fitted`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let main = { $defs: { card: { properties: { name: { type: 'string' } } } } }
 * let draft = { $defs: {
 *   card: { properties: { name: { type: 'number' }, color: { type: 'string' } } },
 *   note: { properties: { text: { type: 'string' } } },
 * } }
 * assertEquals(widened(main, [draft]).$defs, {
 *   card: { properties: { name: { type: 'string' }, color: { type: 'string' } } },
 *   note: { properties: { text: { type: 'string' } } },
 * })
 * ```
 */
export let widened = (main: VocabDoc, others: VocabDoc[]): VocabDoc => {
  let defs = { ...main.$defs }
  for (let other of others) {
    for (let [name, def] of Object.entries(other.$defs ?? {})) {
      let had = defs[name]
      defs[name] = had
        ? {
          ...had,
          properties: { ...def.properties, ...had.properties },
        }
        : def
    }
  }
  return { ...main, $defs: defs }
}

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
  // A dependency the next manifest stopped naming is held as a word is: it
  // stays while a component it lent holds rows, so a rollback to a release
  // that named fewer packages serves what is stored; one whose components
  // hold nothing leaves, and their tables with it.
  let packages = packagesOf(next)
  for (let pkg of packagesOf(was)) {
    if (packages.includes(pkg)) continue
    let [lending] = lent([pkg], Object.keys(defs))
    let words = (lending?.[3] ?? []).filter((name) =>
      entriesOf(pkg).some(([n, s]) => n == name && s.extends !== true)
    )
    if (words.some((name) => rows(name))) packages = [...packages, pkg]
    else dropped.push(...words)
  }
  let doc: VocabDoc = { ...next, $defs: defs }
  if (packages.length) doc.packages = packages.toSorted()
  return { doc, dropped, added, kept, retyped }
}

/**
 * Where each word of a space lives: the component schemas one app homes, by
 * name. Read off that app's `/vocab`, which answers only the words it homes —
 * so a use never looks like a second declaration (tools.ts `homesIn`).
 */
export type Homes = Record<
  string,
  { at: string; props: Record<string, PropSchema>; schema?: PropSchema }
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
 * A conflicting lifetime is refused before growth. A shape conflict — the same property with two types —
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
    // A name does not override its home's lifetime. Refuse before any
    // properties are grown: otherwise a relayed cursor can silently become
    // stored data (or the reverse) merely because another app named it first.
    let declaredSync = syncValue(schema.sync)
    let homeSync = syncValue(home.schema?.sync)
    let declaredDurable = durableValue(schema.durable)
    let homeDurable = durableValue(home.schema?.durable)
    let sameDurable = declaredDurable == homeDurable ||
      (ms(declaredDurable) != null && ms(declaredDurable) == ms(homeDurable))
    if (declaredSync != homeSync || !sameDurable) {
      throw refuse(
        'arguments',
        `vocab.json: ${name} declares sync: ${declaredSync}, durable: ${declaredDurable} ` +
          `here, but sync: ${homeSync}, durable: ${homeDurable} in ${home.at}, where ${name} lives — ` +
          'a borrowed component keeps its home’s lifetime; use a distinct name for a different aspect',
      )
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
            `rows were written under, so declare ${prop} as ${
              wordOf(had)
            } as ${home.at} does, or give this one a property name of its own`,
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

/**
 * An app's `vocab.json` as one document ({@link manifest}), whose permission
 * and owner names resolve in the vocabulary its store composes.
 */
export let appDoc = (source: unknown, file = 'vocab.json'): VocabDoc => {
  let doc = manifest(source, file)
  // A companion can be supplied by the platform, so permission and owner names
  // resolve in the same composed vocabulary the store will hold: a manifest
  // the store could not load never deploys.
  if (owns(doc)) owned(composed(pluginsOf(doc), [doc], appOptions).vocab, file)
  return doc
}
/**
 * The components a manifest declares with no `description`. An agent that
 * meets one knows only its name, since the descriptions are the app's
 * documentation (D-162751). Nothing is refused for it.
 */
export let undescribed = (doc: VocabDoc): string[] =>
  components(doc)
    .filter(([, s]) => !s.description?.trim())
    .map(([name]) => name)

// A property whose name cannot say what it takes: a reference, which names
// no kind of thing it points at, and a flag, which names no meaning for true.
let mute = (s: PropSchema) =>
  !s.description?.trim() && !s.stamped && s.computed !== true &&
  (!!s.ref || s.type == 'boolean')

/**
 * What an app's vocabulary leaves an agent to guess, as warnings it is shown
 * until each is written (D-162751, C-162917): the components with no
 * `description`, then the references and flags with none. They stand on the
 * app, said by the deploy, `commands` naming it and `app_errors`, and they go
 * when the descriptions are written and deployed. Nothing is refused.
 */
export let unwritten = (doc: VocabDoc, file = 'vocab.json'): string[] => {
  let quiet = undescribed(doc)
  let props = components(doc).flatMap(([name, s]) =>
    Object.entries(s.properties ?? {})
      .filter(([, p]) => mute(p))
      .map(([prop]) => `${name}.${prop}`)
  )
  return [
    ...quiet.length
      ? [
        `no description yet: ${quiet.join(', ')} — say in ${file} what ` +
        'each is and where a person sees it',
      ]
      : [],
    ...props.length
      ? [
        `no description yet: ${props.join(', ')} — say what each reference ` +
        'points at and what each flag means',
      ]
      : [],
  ]
}

/**
 * A new manifest, refused if it declares a component the platform already declares
 * ({@link reserved}) — all of them at once, before anything is planted: a
 * manifest refused one name at a time is probed one deploy at a time, and every
 * probe that got through left a component behind for good (C-32624 item 1).
 * The sentence is the one the guide prints under "Reserved component names",
 * and it says why and names every reserved word, because the agent reading it
 * picks its next name from this answer alone.
 *
 * `held` is what the app holds already ({@link held}), and a word it holds stays
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
      reserved().includes(n) && !(n in (held.$defs ?? {})) &&
      !accepted.includes(n)
    )
  let unknown = unnamed(doc)
  if (unknown.length) {
    throw refuse(
      'arguments',
      `${file}: "kinds" names ${unknown.join(', ')}, which neither ${file} ` +
        'nor the platform declares — declare each in $defs, or use a word ' +
        `every app's store has (doc, alias); how to declare a kind: call ` +
        `guide with page components, or ${GUIDE}`,
    )
  }
  if (taken.length) {
    let had = taken.flatMap((n) => {
      let props = shapeOf(n)
      return props ? [`${n}{${props.join(', ')}}`] : []
    })
    throw refuse(
      'arguments',
      `${file}: ${taken.join(', ')} ${
        taken.length == 1 ? 'is a component' : 'are components'
      } the platform already declares — pick another name` +
        (had.length
          ? `, or use ${had.join(', ')} as every app's store already has ${
            had.length == 1 ? 'it' : 'them'
          }, leaving ${had.length == 1 ? 'it' : 'them'} out of ${file}`
          : '') +
        ". Every app's store already holds the platform's components, so " +
        'a name means the same thing in every store and no app can give it ' +
        `another shape. The reserved names: ${reserved().join(' ')} (the ` +
        `guide's "Reserved component names", ${GUIDE})`,
    )
  }
  return doc
}

// The components a manifest's kinds name that its store would not speak: not
// its own, not the platform's, and lent by none of its dependencies.
let unnamed = (doc: VocabDoc): string[] => {
  let kinds = Object.entries((doc.kinds ?? {}) as Record<string, KindDecl>)
  if (!kinds.length) return []
  let spoken = new Set([
    ...everywhere(),
    ...declares(doc),
    ...lentDocs(doc).flatMap((d) => Object.keys(d.$defs ?? {})),
  ])
  let named = kinds.flatMap(([name, k]) => [
    ...k.is ?? [name],
    ...Object.keys(k.with ?? {}),
  ])
  return [...new Set(named.filter((c) => !spoken.has(c)))]
}

/** The properties of a component every app's store already has, or nothing
 * for a word only the platform's own stores speak. */
export let shapeOf = (name: string): string[] | undefined => {
  let def = coreDocs().find((d) => d.reserved !== false && d.$defs?.[name])
    ?.$defs?.[name]
  if (!def || def.tool === true || def.lens === true) return
  return Object.keys(def.properties ?? {})
}

/**
 * An app's declaration as its files say it: its `vocab.json` (or `.yml`), and
 * the packages its package.json names as `"platform"` dependencies, whose
 * code the compile hands its pages and whose words its store speaks
 * ({@link lent}). package.json is read as the compile reads it (@yaks/esbuild
 * `dependencies`) and refused in the same words; `packages` is said nowhere
 * else, so a manifest saying it is refused too.
 */
export let stated = (
  source: string | null,
  file = 'vocab.json',
  pkg: string | null = null,
): VocabDoc => {
  let doc = appDoc(source ?? {}, file)
  if (doc.packages) {
    throw refuse(
      'arguments',
      `${file}: "packages" — a store speaks the words of the packages ` +
        'package.json names as "platform" dependencies, and that is said ' +
        'nowhere else: drop it here',
    )
  }
  let named: Record<string, string>
  try {
    named = dependencies(pkg)
  } catch (e) {
    if (e instanceof Unplanned) throw refuse('arguments', e.message)
    throw e
  }
  let packages = Object.keys(named).filter((n) => named[n] == 'platform')
  return packages.length ? { ...doc, packages: packages.sort() } : doc
}

/**
 * A manifest, refused if it declares a word one of its `"platform"`
 * dependencies lends, or if two of them lend one word: a store speaks one of
 * each, and in it the app's own word would hide the package's. Two
 * dependencies are refused by the composition itself (@yaks/vocab
 * `loadVocab`), which names the word and both packages.
 *
 * `held` and `accepted` are {@link unsaid}'s: a word the store already held as
 * its own beside the same dependency stays its own when that package later
 * says it too, and so does every word of a release already admitted.
 */
export let unlent = (
  doc: VocabDoc,
  held: VocabDoc = {},
  file = 'vocab.json',
  accepted: string[] = [],
): VocabDoc => {
  let packages = packagesOf(doc)
  if (!packages.length) return doc
  let mine = new Set(declares(doc))
  let kept = (name: string, pkg: string) =>
    accepted.includes(name) ||
    name in (held.$defs ?? {}) && packagesOf(held).includes(pkg)
  for (let [, , pkg, names = []] of lent(packages)) {
    let twice = entriesOf(pkg).find(([name, s]) =>
      s?.extends !== true && names.includes(name) && mine.has(name) &&
      !kept(name, pkg)
    )?.[0]
    if (twice) {
      throw refuse(
        'arguments',
        `${file}: ${twice} is declared twice, by ${pkg} and by ${file} — ` +
          `package.json names ${pkg} as a "platform" dependency, and its ` +
          `words are this app's store's too: rename ${twice}, or drop ${pkg}`,
      )
    }
  }
  try {
    appWords(doc)
  } catch (e) {
    // Only the dependencies' to answer for when the app's own words stand.
    appWords({ ...doc, packages: [] })
    throw refuse('arguments', `package.json: ${(e as Error).message}`)
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
 * The words an app holds already, for {@link unsaid}: those its serving
 * declaration says, and those its store declares. They differ where a store
 * outlived its declaration, as one restored beside a new app row does, and
 * the store's words are the app's because its rows were written under them.
 *
 * ```ts
 * import { heldWords } from './vocab.ts'
 * import { equal } from '@std/assert'
 *
 * equal(
 *   Object.keys(heldWords({ $defs: { day: {} } }, { $defs: { cost: {} } }).$defs!),
 *   ['cost', 'day'],
 * )
 * ```
 */
export let heldWords = (
  said: VocabDoc = {},
  stored: VocabDoc = {},
): VocabDoc => ({
  $defs: { ...stored.$defs, ...said.$defs },
})

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
  let v = composed(
    pluginsOf(doc),
    appDocs(doc),
    appOptions,
  )
  appVocabs.set(key, v)
  if (appVocabs.size > 64) appVocabs.delete(appVocabs.keys().next().value!)
  return v
}
export let appVocab = (source: unknown = {}): Vocab => appWords(source).vocab

/**
 * How this store numbers its entities, read off the vocabulary it woke with:
 * @yaks/id's document is the one place `entity.num` is declared, so a store
 * that loaded it numbers each entity holding a component that declares a
 * `prefix`, in that letter's series, and one that did not numbers nothing.
 * The storage adapter is told this (graph.ts), so there is one answer rather
 * than a vocabulary saying one thing and the writer doing another.
 */
export let numbered = (v: Vocab): false | Series =>
  !!v.prop('entity', 'num') && prefixes(v)
