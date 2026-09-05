// The keyword vocabulary, importable: the core $vocabulary declaration document
// and the meta-schema a vocab file validates against. The .json files under
// meta/ are the authored source; this module only gives them names.

import coreDoc from './meta/core.vocab.json' with { type: 'json' }
import metaDoc from './meta/vocab.schema.json' with { type: 'json' }

// A JSON Schema document, held loosely — validators own the tight shape.
export type JsonSchema = Record<string, unknown>

// The core yaks keywords: ref, death, persist, stamped, kind, before, wire,
// bare, aliases — what a component table needs beyond native JSON Schema.
export let coreVocabulary: JsonSchema = coreDoc

// The meta-schema: what a well-formed vocab file looks like.
export let metaSchema: JsonSchema = metaDoc

// The vocabulary URI a vocab file declares under $vocabulary for the core layer.
export let CORE_URI = 'https://yaks.sh/vocab/core'
