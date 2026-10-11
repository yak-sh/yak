// Composed person-owned policy, independent of the host's app-level guard.
import type { Host, Options } from '@yaks/host'
import type { Plugin } from '@yaks/graph'
import { type Personal, personal } from './personal.ts'

/** Hosts choose protected components; apps can also declare personal aspects. */
export let plugins = (
  host: Pick<Host, 'vocab'>,
  options: Options,
): Plugin[] => [personal(host.vocab, options.personal as Personal | undefined)]
