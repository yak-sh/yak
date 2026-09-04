// The keyword vocabulary, importable: the two $vocabulary declaration documents
// (core and fleet layers) and the meta-schema a vocab file validates against.
// The .json files under meta/ are the authored source; this module only gives
// them names.

import coreDoc from './meta/core.vocab.json' with { type: 'json' }
import fleetDoc from './meta/fleet.vocab.json' with { type: 'json' }
import metaDoc from './meta/vocab.schema.json' with { type: 'json' }

// A JSON Schema document, held loosely — validators own the tight shape.
export type JsonSchema = Record<string, unknown>

// The core yaks keywords: ref, death, persist, stamped, store, kind, before,
// wire, aliases — what a component table needs beyond native JSON Schema.
export let coreVocabulary: JsonSchema = coreDoc

// The fleet layer: prefix and by_name — declared and carried, behavior deferred.
export let fleetVocabulary: JsonSchema = fleetDoc

// The meta-schema: what a well-formed vocab file looks like.
export let metaSchema: JsonSchema = metaDoc

// The vocabulary URIs a vocab file declares under $vocabulary.
export let CORE_URI = 'https://yaks.sh/vocab/core'
export let FLEET_URI = 'https://yaks.sh/vocab/fleet'
