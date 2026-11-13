/**
 * `@yaks/workerd/worker` — this package's own `./worker` facet: the route
 * that says which deploy a Worker runs ({@link version}). Name it first in a
 * Worker's config, so it answers before any other plugin's routes:
 *
 * ```json
 * { "use": "@yaks/workerd", "with": { "name": "shop", "version": { "binding": "CF_VERSION_METADATA" } } }
 * ```
 *
 * @module
 */
import type { Route } from '@yaks/api'
import type { Options } from '@yaks/host/config'
import { version } from './version.ts'

export { VERSION } from './version.ts'

/** The routes this facet adds: the deploy's version. */
export let routes = (options: Options): Route[] => [version(options)]
