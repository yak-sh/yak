// The deploy a Worker is running, said at one path. It is a route of this
// package's own `./worker` facet (plugin.ts), so it answers before anything a
// later plugin loads: an old Durable Object or a broken router cannot name
// the deploy in its place.
import type { Route } from '@yaks/api'
import type { Options } from '@yaks/host/config'

/** The path a Worker says its deploy at. */
export let VERSION = '/_yak/version'

/** The route answering {@link VERSION} with `{<name>: <id>}`: `options.name`
 * names the Worker (default `worker`) and `options.version` is its
 * `[version_metadata]` binding, whose `id` changes with every deploy. */
export let version = (options: Options): Route => ({
  method: 'GET',
  path: VERSION,
  handle: (req) => {
    let name = typeof options.name == 'string' ? options.name : 'worker'
    let id = (options.version as { id?: string } | undefined)?.id ?? null
    return new Response(
      req.method == 'HEAD' ? null : JSON.stringify({ [name]: id }),
      {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    )
  },
})
