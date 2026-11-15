// The `yak/blob` routes facet: an app's file door at `./api/blob` beside its
// pages, answered as yaks.app answers it (workers/yak uploads.ts `door`):
// @yaks/blob's door in the app's words (./uploads.ts), held to what its
// vocab.json takes (`"blob"`), into the host's artifact store. A page's
// client uploads through it (./client.js `upload`).
import type { Accepts } from '@yaks/blob'
import type { Route } from '@yaks/api/routed'
import { routes as door } from '@yaks/blob/routes'
import type { Options } from './lent.ts'
import { UPLOADS, uploads } from './uploads.ts'

export let routes = (
  host: Parameters<typeof door>[0],
  { store }: Options,
): Route[] =>
  door(host, {
    at: UPLOADS,
    naming: uploads,
    accepts: store.manifest().blob as Accepts | undefined,
  })
