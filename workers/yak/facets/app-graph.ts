import type { Host } from '@yaks/host'
import { documentPages } from '../document-graph.ts'
export let plugins = (host: Pick<Host, 'vocab'>) =>
  host.vocab.comp('document_page') ? [documentPages()] : []
