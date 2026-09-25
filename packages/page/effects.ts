// What the server does about a page, exported as `@yaks/page/effects`: the
// code behind `web_freeze` (./vocab.json), which fetches a page recorded by
// its address alone and stores its bytes.
//
// The archiver is why this entry point accepts OPTIONS. Turning a live URL into
// one self-contained document is an external command's job, and which command
// under which time limit is nothing anybody could read off an entity, so the
// configuration names it beside the plugin and ./host.ts builds it.
//
// A server configured with no archiver gives it no code, so a recorded address
// is left as it is — which is what a graph fed only by a browser extension
// wants, rather than every address queuing up against a command nobody
// installed.

import type { Blobs } from '@yaks/blob'
import type { Handlers } from '@yaks/effects'
import { freezing } from './freeze.ts'
import { archiver, blobsOf, type Options } from './host.ts'

export type { Options }

/** The capture handler, when an archiver was configured. */
export let effects = (
  host: { blobs: Blobs },
  options: Options = {},
): Handlers =>
  options.archive
    ? {
      web_freeze: freezing({
        archive: archiver(options.archive),
        blobs: blobsOf(host, options),
      }),
    }
    : {}
