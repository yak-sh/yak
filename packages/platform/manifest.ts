// An app's vocab.json read as one document: the rules every host that serves
// an app loads its manifest by, so a manifest means the same in each. Which
// names the platform already says, and what a deploy keeps of the manifest
// before it, are the deploying host's to say.
import { CallError } from '@yaks/tools/errors'
import { floored, isFloor } from '@yaks/member'
import { acceptsErrors } from '@yaks/blob'
import { read } from '@yaks/yaml'
import { parse } from '@yaks/query'
import {
  type KindDecl,
  metaDoc,
  type PropSchema,
  storable,
  type VocabDoc,
} from '@yaks/vocab'
import { docs as lensDocs } from '@yaks/lens/vocab'
import { url } from './host.ts'
import { sessionLens } from './lenses.ts'
import { noticeEffects } from './notices-vocab.ts'

let refuse = (code: string, text: string) => new CallError(code, text)

/** The smallest manifest, as a refusal shows one. */
export let EXAMPLE: string =
  '{"$defs": {"recipe": {"properties": {"serves": {"type": "number"}}}}}'
/** A `kinds` entry, as a refusal shows one. */
export let KINDS: string =
  '{"kinds": {"meal": {"is": ["dish"], "with": {"doc": true, "tasting": {"stars": 0}}}}}'
/** The guide's page, where a refusal sends the person writing a manifest. */
export let GUIDE: string = url({}, '/docs.md')

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/** One component an app declared. Its own word is the most specific thing said
 * about a row — an entity wearing `recipe` is a recipe, not the `doc` it also
 * wears for its title — so it is a kind sorting before `doc` unless the
 * manifest says otherwise, which is also what earns it its two tools
 * (./app-commands.ts). A manifest that declares `kinds` says which its kinds are, so
 * there a component is one only where it says `kind: true` itself. */
let mine = (schema: PropSchema, implicit: boolean): PropSchema =>
  schema.lens === true ? schema : ({
    // `component: true` is the marker @yaks/vocab wants on a component, and it
    // is put on here rather than asked of the person: an app manifest's $defs
    // entries are its components, save the ones marked `tool: true`, and a store
    // that accepted one before the marker existed reads back the same way
    // (T-37551).
    component: true,
    type: 'object',
    ...implicit || schema.kind === true ? { kind: true, before: ['doc'] } : {},
    ...schema,
  })

/** One kind an app declared under `kinds`: like a component of its own, it
 * sorts before the `doc` its rows wear for their titles, unless it says what it
 * sorts before. */
let kindOf = (decl: KindDecl): KindDecl =>
  object(decl) && decl.before === undefined
    ? { ...decl, before: ['doc'] }
    : decl

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
 * What is wrong with a manifest's `join` (join.ts): `emails` and `phones`
 * name this manifest's own properties as `component.property` (`phones` may
 * also name the platform's `phone.number`), `where` is a query, `domain` is
 * an email domain, `role` is viewer or editor, and at least one of emails,
 * phones or domain is said.
 */
/// joinErrors({ domain: 'example.org' }, {}) -> []
/// joinErrors({ emails: ['m.email'] }, { m: { properties: { email: {} } } }) -> []
/// joinErrors({ phones: ['phone.number'], where: '.m.status=member' }, {}) -> []
/// joinErrors({ phones: ['phone.number'], where: '(.m.status=x' }, {}).length -> 1
/// joinErrors({ role: 'owner' }, {}).length -> 2
export let joinErrors = (join: unknown, defs: unknown): string[] => {
  if (!object(join)) {
    return [
      'it is an object: { "emails": ["member.email"], "phones": ' +
      '["phone.number"], "domain": "example.org", "role": "viewer" }',
    ]
  }
  let own = object(defs) ? defs : {}
  let declared = (path: string) => {
    let [comp, prop, ...more] = path.split('.')
    let def = own[comp]
    return !more.length && object(def) && object(def.properties) &&
      prop in def.properties
  }
  let paths = (name: string, list: unknown, also: string[] = []) =>
    list === undefined ||
      Array.isArray(list) && list.every((e) => typeof e == 'string')
      ? (list as string[] ?? []).filter((e) =>
        !declared(e) && !also.includes(e)
      ).map((e) =>
        `${name}: ${e} is not a component.property this manifest declares`
      )
      : [
        `${name} is a list of component.property names, e.g. ["member.${
          name.slice(0, -1)
        }"]`,
      ]
  let { emails, phones, where, domain, role, ...rest } = join
  let query = () => {
    try {
      parse(where as string)
      return []
    } catch (e) {
      return [`where is a query: ${(e as Error).message}`]
    }
  }
  return [
    ...Object.keys(rest).map((k) =>
      `${k} is not one of its words: emails, phones, where, domain, role`
    ),
    ...paths('emails', emails),
    ...paths('phones', phones, ['phone.number']),
    ...where === undefined
      ? []
      : typeof where == 'string' && where.trim()
      ? query()
      : ['where is a query, such as ".member.status=current"'],
    ...domain === undefined ||
        typeof domain == 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)
      ? []
      : ['domain is an email domain, such as example.org, without the @'],
    ...role === undefined || role == 'viewer' || role == 'editor'
      ? []
      : ['role is viewer or editor: what joining makes them'],
    ...emails === undefined && phones === undefined && domain === undefined
      ? ['it names emails, phones, a domain, or some of them: who may join']
      : [],
  ]
}

/**
 * What is wrong with a manifest's `kinds` (@yaks/vocab kinds.ts): an object of
 * kinds by name, each an object whose `is` lists component names, whose `with`
 * maps each component to `true` (its writer supplies it) or to the values a
 * rule gives it, and whose `before` lists kinds. Which components exist is
 * {@link unsaid}'s to say, at the doors a new manifest comes through.
 */
/// kindErrors({ meal: { with: { doc: true, tasting: { stars: 0 } } } }) -> []
/// kindErrors({ meal: { is: ['recipe', 'guest'] } }) -> []
/// kindErrors({ recipe: { with: { doc: false } } }).length -> 1
/// kindErrors({ recipe: { is: 'recipe' } }).length -> 1
/// kindErrors(['recipe']).length -> 1
export let kindErrors = (kinds: unknown): string[] => {
  if (!object(kinds)) {
    return [`it is an object, one entry per kind: ${KINDS}`]
  }
  let names = (v: unknown) =>
    Array.isArray(v) && v.length > 0 && v.every((e) => typeof e == 'string')
  let WORDS = ['title', 'description', 'is', 'with', 'before', 'examples']
  return Object.entries(kinds).flatMap(([name, d]) => {
    if (!object(d)) return [`${name} is an object: ${KINDS}`]
    return [
      ...Object.keys(d).filter((k) => !WORDS.includes(k)).map((k) =>
        `${name}.${k} is not one of its words: ${WORDS.join(', ')}`
      ),
      ...d.is === undefined || names(d.is)
        ? []
        : [`${name}.is lists the components that make one, e.g. ["${name}"]`],
      ...d.before === undefined || names(d.before)
        ? []
        : [`${name}.before lists the kinds it sorts before`],
      ...d.with === undefined
        ? []
        : !object(d.with)
        ? [`${name}.with is an object of components: {"doc": true}`]
        : Object.entries(d.with).filter(([, w]) => w !== true && !object(w))
          .map(([c]) =>
            `${name}.with.${c} is true (its writer supplies it) or the ` +
            `values a rule gives it, e.g. {"stars": 0}`
          ),
      ...d.examples === undefined ||
          Array.isArray(d.examples) && d.examples.every(object)
        ? []
        : [`${name}.examples is a list of whole bundles of one`],
    ]
  })
}

/** The files an app's words may be written in, the one read when both
 * are there first. */
export let VOCABS: string[] = ['vocab.yml', 'vocab.json']

/**
 * An app's `vocab.json` as one document: a JSON Schema 2020-12 document with
 * `$defs`, which is the one form a manifest is written in. A manifest of
 * bare component names declares no `$` keyword, and is refused in a sentence
 * naming the shape.
 *
 * It is checked here rather than at the load: anything a property cannot hold
 * is refused. A name the platform already declares is the deploying host's to
 * refuse at the doors a new manifest comes through (workers/yak vocab.ts
 * `unsaid`), because this one also reads what a store already holds. Its
 * permission and owner names are checked where its store's words are composed
 * (workers/yak vocab.ts `appDoc`).
 *
 * `file` is what a refusal calls it — the app may have written it as `.json` or
 * `.yml` (workers/yak tools.ts `spelled`), and the sentence has to name the
 * file they are looking at.
 *
 * `"tools": false`, `"models": "open"`, `"rtc": "open"` and `"blob"` are the
 * words a manifest says about itself rather than about a component, so each is
 * lifted off and carried on the document. `tools: false` synthesizes no tools
 * for its kinds (./app-commands.ts); a boolean tells it from a component named
 * `tools`, which is an object of properties like any other. `models` and `rtc`
 * are each {@link OPENS}: who may spend the space's budget through the
 * app. `blob` is which uploads the app takes (@yaks/blob `Accepts`), checked
 * where bytes come in, and its `floor` who may upload them (app-authority.ts
 * `floorsOf`). `join` is who may join the app by being listed in its own rows
 * ({@link joinErrors}). `packages` is the one the person never writes here: a
 * deploy lifts it off package.json's `"platform"` dependencies (workers/yak
 * vocab.ts `stated`), and the store speaks their words.
 *
 * `kinds` names the app's shapes (@yaks/vocab, kinds.ts): each kind's `is`
 * components and what a whole one also carries. A manifest without it has a
 * kind for each component, as every manifest written before it did.
 *
 * A `$defs` entry marked `"tool": true` is one of the app's commands, not a
 * component: it is left out here and read by @yaks/tools/declared `parseTools`, so a
 * store's vocabulary holds components alone.
 */
export let manifest = (source: unknown, file = 'vocab.json'): VocabDoc => {
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
  if (held.blob !== undefined) {
    // `floor` is who may upload, a word of the platform's rather than of the
    // bytes (@yaks/blob), so it is checked here and the rest there.
    let { floor, ...accepts } = object(held.blob) ? held.blob : {}
    let wrong = [
      ...acceptsErrors(object(held.blob) ? accepts : held.blob),
      ...floor === undefined || isFloor(floor)
        ? []
        : ['floor is person, viewer, editor or owner: who may upload'],
    ]
    if (wrong.length) {
      throw refuse('arguments', `${file}: "blob": ${wrong.join('; ')}`)
    }
  }
  if (held.join !== undefined) {
    let wrong = joinErrors(held.join, held.$defs)
    if (wrong.length) {
      throw refuse('arguments', `${file}: "join": ${wrong.join('; ')}`)
    }
  }
  let packages = held.packages
  if (
    packages !== undefined &&
    (!Array.isArray(packages) || packages.some((p) => typeof p != 'string'))
  ) {
    throw refuse('arguments', `${file}: "packages" is a list of package names`)
  }
  let body = Object.fromEntries(
    Object.entries(held).filter(([k]) =>
      !(k == 'tools' && off !== undefined) && !(k in OPENS) && k != 'blob' &&
      k != 'join' && k != 'packages'
    ),
  )
  let keys = Object.keys(body)
  if (keys.length && !keys.some((k) => k.startsWith('$'))) {
    throw refuse(
      'arguments',
      `${file}: ${keys.join(', ')} — a manifest is a JSON Schema document, ` +
        `one $defs entry per component and one properties entry per property: ` +
        `${EXAMPLE}; the whole of it is in the guide under ` +
        `"Declaring components in vocab.json" (${GUIDE})`,
    )
  }
  let doc = body as VocabDoc
  let kinds = doc.kinds as Record<string, KindDecl> | undefined
  if (kinds !== undefined) {
    let wrong = kindErrors(kinds)
    if (wrong.length) {
      throw refuse('arguments', `${file}: "kinds": ${wrong.join('; ')}`)
    }
  }
  if (doc.$defs) {
    doc = {
      ...doc,
      $defs: Object.fromEntries(
        Object.entries(doc.$defs)
          .filter(([, s]) => s?.tool !== true)
          .map(([name, s]) => [name, mine(s, !kinds)]),
      ),
    }
  }
  if (kinds) {
    doc = {
      ...doc,
      kinds: Object.fromEntries(
        Object.entries(kinds).map(([name, d]) => [name, kindOf(d)]),
      ),
    }
  }
  if (off !== undefined) doc = { ...doc, tools: off }
  for (let [word] of opens) doc = { ...doc, [word]: held[word] }
  if (held.blob !== undefined) doc = { ...doc, blob: held.blob }
  if (held.join !== undefined) doc = { ...doc, join: held.join }
  if (packages?.length) {
    doc = { ...doc, packages: [...new Set(packages)].sort() }
  }
  let errs = [...storable(doc), ...floored(doc)]
  if (errs.length) throw refuse('arguments', `${file}: ${errs.join('; ')}`)
  return doc
}

/** What an app's store speaks beside its plugins' words, its manifest's
 * components shadowing theirs: the meta vocabulary, the lenses' words and
 * the hosted session lens, the manifest, and the effects its notices run. */
export let appDocs = (doc: VocabDoc): VocabDoc[] => [
  metaDoc,
  ...lensDocs,
  sessionLens,
  doc,
  noticeEffects(doc),
]
