// What a host DOES about a page: the `effects` facet
// (`@yaks/page/effects`) — one `created(web)` watch that fetches a page
// witnessed by its address alone and lands its bytes.
//
// The archiver is the reason this facet takes OPTIONS. Turning a live URL
// into one self-contained document is an external tool's job, and which tool
// under which time limit is nothing anybody could read off an entity, so the
// config names it beside the plugin and ./host.ts builds it.
//
// A host that names no archiver gets no watch — which is what a graph
// witnessed only by a browser extension wants, rather than every address
// somebody files queuing against a tool nobody installed.

import type { Watch } from '@yaks/effects'
import type { Driver } from '@yaks/sqlite'
import { WEB } from './comp.ts'
import { freezing } from './freeze.ts'
import { archiver, blobsOf, type Options } from './host.ts'

export type { Options }

/** The capture: `created(web)`, where an archiver was named. */
export let effects = (
  host: { sql: Driver },
  options: Options = {},
): Watch[] =>
  options.archive
    ? [{
      comp: WEB,
      created: freezing({
        archive: archiver(options.archive),
        blobs: blobsOf(host, options),
      }),
      doc: 'archive a page witnessed by its address, and store its bytes',
    }]
    : []
