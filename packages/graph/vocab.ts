// The words the GENERIC TIER is called by: the `vocab` facet of this package
// (`@yaks/graph/vocab`) — the five tools every graph answers, declared in
// ./vocab.json and run from @yaks/mcp `core`.
//
// They are words like any other package's: `graph apply`, `graph query`,
// `graph show`, `graph schema` and `search`, spelled `graph_apply` and the
// rest on a transport with one flat name. Declaring them here rather than
// writing them into a listing is what makes a line and a tool list the same
// sentence — and it is this package's to declare, because what they do is the
// graph itself, not whatever door happened to carry them.
//
// No COMPONENT is declared here: the tier describes a store, it does not add
// anything to one.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declarations the generic tier is listed and typed from. */
export let graphDoc: VocabDoc = doc

/** Every document this package declares. */
export let docs: VocabDoc[] = [graphDoc]
