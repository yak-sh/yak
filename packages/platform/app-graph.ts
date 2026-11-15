// The yak/app graph facet: a document's pages kept with it, in a store whose
// words have them (./document-graph.ts).
import type { Plugin } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { documentPages } from './document-graph.ts'

export let plugins = (host: Pick<Host, 'vocab'>): Plugin[] => [
  ...host.vocab.comp('document_page') ? [documentPages()] : [],
]
