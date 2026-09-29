// The keyword vocabulary, importable: the core $vocabulary declaration document,
// the meta-schema a vocabulary document validates against, and the meta
// vocabulary a vocabulary is described in as entities. The .json files under
// meta/ are the authored source; this module only gives them names.

import coreDoc from './meta/core.vocab.json' with { type: 'json' }
import schemaDoc from './meta/vocab.schema.json' with { type: 'json' }
import vocabDoc from './meta/vocab.json' with { type: 'json' }
import type { VocabDoc } from './types.ts'

// A JSON Schema document, held loosely — validators own the tight shape.
export type JsonSchema = Record<string, unknown>

// The core yaks keywords: ref, death, computed, stamped, search, sync,
// durable, kind, before, wire, bare, aliases — what a component table needs
// beyond native JSON Schema.
export let coreVocabulary: JsonSchema = coreDoc

// The meta-schema: what a well-formed vocabulary document looks like.
export let metaSchema: JsonSchema = schemaDoc

/** The meta vocabulary: `_comp`, `_prop` and the `_before` relation, the
 * components a vocabulary is described in as entities (./bundles.ts). Its
 * names start with `_`, which no authored name can, so it is loaded like any
 * other document and never checked as one a person wrote. */
export let metaDoc: VocabDoc = vocabDoc

// The URI a vocabulary document declares under $vocabulary for the core layer.
export let CORE_URI = 'https://yak.sh/vocab/core'
