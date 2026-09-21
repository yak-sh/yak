// The GENERIC TIER's own declarations: the `./vocab` subpath of this package
// (`@yaks/graph/vocab`) — the five tools every graph answers, declared in
// ./vocab.json and implemented in ./tools.ts, which @yaks/mcp `core` shapes
// for one server.
//
// They are declared the same way any other package declares its tools:
// `graph apply`, `graph query`, `graph show`, `graph schema` and `search`,
// written `graph_apply` and the rest on a transport that gives a tool one flat
// name. Declaring them here rather than writing them into each listing is what
// makes the command line and an MCP tool list describe the same tools — and
// they belong to this package, because what they do is the graph itself, not
// whatever transport carried the call.
//
// No COMPONENT is declared here: the tier describes a store, it does not add
// anything to one.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The tool declarations the generic tier is listed and typed from. */
export let graphDoc: VocabDoc = doc

/** Every document this package declares. */
export let docs: VocabDoc[] = [graphDoc]
