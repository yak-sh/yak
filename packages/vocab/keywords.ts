// The extension seam. JSON Schema 2020-12 already has an extension mechanism —
// a KEYWORD VOCABULARY: a URI naming a set of keywords, a document describing
// each keyword's schema, and a `$vocabulary` declaration in the files that use
// them. This module lets a package outside @yaks/vocab bring its own keywords
// through that same door.
//
// The core vocabulary (meta.ts) describes what a component TABLE needs. Anything
// beyond that — an id prefix, a name column, a unit of measure — is somebody
// else's concern, so it arrives as a `Keywords` registration: `loadVocab(docs,
// [myKeywords])` makes the loader carry those keywords onto the components and
// columns that declare them, and `extendMeta` composes them into the published
// meta-schema so a vocab file using them still validates.
//
// The loader CARRIES an extension keyword; it never interprets one. What a
// keyword MEANS belongs to the package that declared it.

import type { JsonSchema } from './meta.ts'
import { metaSchema } from './meta.ts'

/**
 * A keyword vocabulary a package contributes: the `$vocabulary` URI that names
 * it, which keywords it adds at the component and column level, and optionally
 * the declaration document describing each keyword's own schema (the shape of
 * `meta/core.vocab.json` — a `$defs` entry per keyword).
 */
export type Keywords = {
  /** the URI a vocab file declares under `$vocabulary` for this keyword set */
  uri: string
  /** keywords this vocabulary adds to a component (a `$defs` entry) */
  comp?: string[]
  /** keywords this vocabulary adds to a column (a component's property) */
  column?: string[]
  /** the declaration document: `$defs[keyword]` is that keyword's schema */
  doc?: JsonSchema
}

// One keyword's own schema, from the declaration document — `true` (accept
// anything) when the vocabulary named the keyword without describing it.
let schemaOf = (k: Keywords, name: string): unknown => {
  let defs = k.doc?.$defs as Record<string, unknown> | undefined
  return defs?.[name] ?? true
}

// A meta-schema `$defs` entry with more properties admitted. The core entries
// are closed (`additionalProperties: false`), so an extension keyword has to
// arrive as a named property or the file it appears in stops validating.
let admit = (def: unknown, add: Record<string, unknown>): unknown =>
  !def || typeof def != 'object' ? def : {
    ...def as Record<string, unknown>,
    properties: {
      ...(def as { properties?: Record<string, unknown> }).properties,
      ...add,
    },
  }

/**
 * The meta-schema, composed with extension vocabularies: every registered
 * keyword is admitted on the component or column it belongs to, and each
 * vocabulary's URI is declared under `$vocabulary`. A vocab file that uses
 * `prefix` validates against `extendMeta([idKeywords])`, not against the bare
 * core meta-schema.
 */
export let extendMeta = (extras: Keywords[]): JsonSchema => {
  let defs = { ...(metaSchema.$defs as Record<string, unknown>) }
  let vocabs = { ...(metaSchema.$vocabulary as Record<string, boolean>) }
  for (let k of extras) {
    vocabs[k.uri] = true
    let props = (names: string[] = []) =>
      Object.fromEntries(names.map((n) => [n, schemaOf(k, n)]))
    defs.component = admit(defs.component, props(k.comp))
    defs.column = admit(defs.column, props(k.column))
  }
  return { ...metaSchema, $vocabulary: vocabs, $defs: defs }
}
