import { formRules } from '../form-rules.ts'
import type { Options } from './store.ts'
import type { Host } from '@yaks/host'
import { documentPages } from '../document-graph.ts'
export let plugins = (host: Pick<Host, 'vocab'>, { store }: Options) => [
  ...host.vocab.comp('document_page') ? [documentPages()] : [],
  ...store.app ? [formRules(store.now)] : [],
]
