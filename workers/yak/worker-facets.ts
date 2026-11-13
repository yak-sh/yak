// Generated from the Worker config. Do not edit.
import type { Config } from '@yaks/host/config'
import type { WorkerFacet } from '@yaks/workerd'
import * as worker0 from '@yaks/workerd/worker'
import * as worker1 from './facets/kernel-worker.ts'
/** The Worker's config, as far as composing it reads: its plugins. */
export let config: Config = {
  'plugins': [{
    'use': '@yaks/workerd',
    'with': {
      'name': 'kernel',
      'version': { 'binding': 'CF_VERSION_METADATA' },
    },
  }, 'yak/kernel'],
}
/** Each plugin's `./worker` facet, by plugin. */
export let facets: Record<string, WorkerFacet> = {
  '@yaks/workerd': worker0,
  'yak/kernel': worker1,
}
