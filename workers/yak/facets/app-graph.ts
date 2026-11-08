import type { Host } from '@yaks/host'
import { documentPages } from '../document-graph.ts'
import { directoryForms } from '../form-directory.ts'
export let plugins = (host: Pick<Host, 'vocab'>) => [
  ...host.vocab.comp('document_page') ? [documentPages()] : [],
  ...host.vocab.comp('individual') ? [directoryForms(host.vocab)] : [],
]
