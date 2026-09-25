// What the server does about a page, exported as `@yaks/page/effects`: one
// `created(web)` handler that fetches a page recorded by its address alone and
// stores its bytes.
//
// The archiver is why this entry point accepts OPTIONS. Turning a live URL into
// one self-contained document is an external command's job, and which command
// under which time limit is nothing anybody could read off an entity, so the
// configuration names it beside the plugin and ./host.ts builds it.
//
// A server configured with no archiver registers no handler — which is what a
// graph fed only by a browser extension wants, rather than every address
// somebody records queuing up against a command nobody installed.

import type { Blobs } from '@yaks/blob'
import type { Watch } from '@yaks/effects'
import { WEB } from './comp.ts'
import { freezing } from './freeze.ts'
import { archiver, blobsOf, type Options } from './host.ts'

export type { Options }

/** The capture handler: `created(web)`, when an archiver was configured. */
export let effects = (
  host: { blobs: Blobs },
  options: Options = {},
): Watch[] =>
  options.archive
    ? [{
      comp: WEB,
      created: freezing({
        archive: archiver(options.archive),
        blobs: blobsOf(host, options),
      }),
      doc: 'archive a page recorded by its address, and store its bytes',
    }]
    : []
