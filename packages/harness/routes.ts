// The routes facet, exported as `@yaks/harness/routes`: where a `yak` host
// that lists the harness and serves `web` answers a model step another host
// forwards to it (@yaks/model/step), from this machine's own providers. That
// is the serving end of a provider that is a machine
// (`provider{name, transport: 'machine', machine}`): the other host sends a
// model request, and the credentials and command lines that answer it stay
// here.
//
// Which providers answer is the config's to say (`serve`, by `provider.name`),
// and naming none answers nothing: listing the harness lends no subscription.
// The route says nothing of who may ask. A machine opens it to another host
// the way it opens any path, such as @yaks/tunnel's `routes`.

import type { Route } from '@yaks/api'
import { signins } from '@yaks/connections'
import type { Host } from '@yaks/host'
import { type Model, serving } from '@yaks/model'
import { answering, PATH } from '@yaks/model/step'
import * as systemProcess from '@yaks/process/system'
import { pooledHttp } from './http.ts'
import type { Opts } from './local.ts'
import { configured, lending } from './providers.ts'
import { hosted } from './store.ts'

/** What a config file can set for this facet. */
export type Options = {
  /** the providers whose models this machine answers another host's model
   * steps from, by `provider.name`; none answers nothing */
  serve?: string[]
}

// The ones of `all` the config names. A name no configured plugin serves is a
// mistake in the config, said at the first step rather than answered as a
// model nobody serves.
let named = (
  all: Record<string, Model>,
  names: string[],
): Record<string, Model> => {
  let missing = names.filter((name) => !Object.hasOwn(all, name))
  if (missing.length) {
    throw new Error(
      `serve names ${missing.join(', ')}, which no plugin of this config ` +
        `serves: ${Object.keys(all).join(', ') || 'none'}`,
    )
  }
  return Object.fromEntries(names.map((name) => [name, all[name]]))
}

/** `POST /model/step`: one model step, answered from the providers `serve`
 * names and streamed as it arrives. `providers` are ones the caller already
 * holds, beside the config's. */
export let routes = (
  host: Host,
  options: Options & Pick<Opts, 'env' | 'http' | 'providers'> = {},
): Route[] => {
  let names = options.serve ?? []
  if (!names.length) return []
  let h = hosted(host)
  // Loaded by the first step: a server that is never asked imports no
  // provider.
  let lent: Promise<Record<string, Model>> | undefined
  let providers = () =>
    lent ??= (async () => {
      let http = pooledHttp(options.http)
      host.defer(http.close)
      let all = await configured(
        h.plugins,
        lending(
          h,
          signins(h),
          http.fetch,
          options.env ?? systemProcess.env.get,
        ),
      )
      return named({ ...all, ...options.providers }, names)
    })()
  let serve: Model = async (request) =>
    await serving(host.graph, await providers())(request)
  return [{
    method: 'POST',
    path: PATH,
    handle: answering(
      serve,
      (error) => host.report?.(error, { during: { request: PATH } }),
    ),
  }]
}
