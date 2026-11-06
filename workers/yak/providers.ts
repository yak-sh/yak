// The model providers yaks.app's config names, each a `./provider` facet
// (@yaks/model `ProviderFacet`) that gen.ts brings into load.ts: those the
// platform's own agents are lent (config.ts `providing`), with its transport
// and settings, and those an app's store is lent (config.ts `serving`), with
// the app's connections. Their options name the env they are read from as
// they are accessed, as the mail and phone providers' do (`{"secret": NAME}`,
// `{"binding": NAME}`), so a key such as `ANTHROPIC_API_KEY` is read at each
// call and never handed to an app. A layer asks for a model by the provider
// name it serves under and imports none.
import {
  type Config,
  given,
  holding,
  type Options,
  type Plug,
  type Reveal,
  revealed,
  used,
} from '@yaks/host/config'
import { KEY, known, resolve } from '@yaks/connections'
import type { Grant } from '@yaks/egress'
import {
  type Lent,
  type Model,
  ModelError,
  type Native,
  type Spending,
} from '@yaks/model'
import { sentinel } from '@yaks/secrets'
import { providing, serving } from './config.ts'
import type { VocabDoc } from '@yaks/vocab'
import { providerFacets, vocabFacets } from './load.ts'
import { ctxOf } from './connections.ts'
import { vaultOf } from './vault.ts'
import type { Env } from './env.ts'

let setting = (env: object, name: string): string | undefined => {
  let value = (env as Record<string, unknown>)[name]
  return typeof value == 'string' && value ? value : undefined
}

/** The words the configured providers record a reply with (their
 * `./vocab`), for a store that keeps their replies. */
export let providerDocs: VocabDoc[] = (providing.plugins ?? []).flatMap(
  (plug) => vocabFacets[used(plug)]?.docs ?? [],
)

/** What the platform lends a provider for its own agents (the Operator, the
 * builder): the transport it holds as it lends and its settings. Nobody is
 * signed in, and it keeps no generated media for them. One lending per env,
 * so a provider that keeps what it read by transport (a catalogue) reads it
 * once. */
export let platform = (env: Env): Lent => {
  let held = platforms.get(env)
  if (held && held.transport == env.MODEL_FETCH) return held.lent
  let send = env.MODEL_FETCH ?? ((input, init) => fetch(input, init))
  let lent = lending(env, send)
  platforms.set(env, { transport: env.MODEL_FETCH, lent })
  return lent
}
let platforms = new WeakMap<
  Env,
  { transport: Env['MODEL_FETCH']; lent: Lent }
>()
let lending = (env: Env, send: typeof fetch): Lent => {
  return {
    fetch: send,
    key: () => Promise.resolve(undefined),
    refresh: () => Promise.resolve(undefined),
    store: () =>
      Promise.reject(
        new ModelError('media_storage', 'The platform keeps no media here'),
      ),
    env: (name) => setting(env, name),
  }
}

// A Lent for asking a plugin which names it serves: making a model calls
// nothing it lends.
let idle: Lent = {
  fetch: () => Promise.reject(new Error('idle')),
  key: () => Promise.resolve(undefined),
  refresh: () => Promise.resolve(undefined),
  store: () => Promise.reject(new Error('idle')),
  env: () => undefined,
}

// Each plugin `config` names, with its options read from `env` and the
// provider names it serves.
let plugged = (env: object, config: Config) =>
  (config.plugins ?? []).map((plug) => {
    let options = revealed(given(plug), holding(env)) as Options
    let facet = providerFacets[used(plug)]
    return {
      plug,
      options,
      facet,
      names: Object.keys(facet?.providers?.(idle, options) ?? {}),
    }
  })

/** The provider names `config`'s plugins serve, in its order: the first is
 * the one a model no row names a provider for is asked of. */
export let names = (env: object, config: Config): string[] =>
  plugged(env, config).flatMap((p) => p.names)

/** Whether the Worker holds every credential of the platform's that the
 * plugin serving `provider` in `config` names. */
export let ready = (env: object, provider: string, config: Config): boolean => {
  let found = plugged(env, config).find((p) => p.names.includes(provider))
  return !!found &&
    named(found.plug, 'secret').every((name) => setting(env, name))
}

/** The own door of the first provider `config` names that has one (@yaks/model
 * `Native`), lent `lent` and held to `spending`, or none. */
export let native = (
  env: object,
  lent: Lent,
  spending: Spending,
  config: Config = serving,
): (Native & { provider: string }) | undefined => {
  let found = plugged(env, config).find((p) => p.facet?.native)
  let door = found?.facet?.native?.(lent, found.options, spending)
  return door && { ...door, provider: found!.names[0] }
}

/** Every model `config`'s providers serve, by the name each serves under,
 * each plugin lent what `lend` makes for it. Two plugins serving one name are
 * refused: which answered would be an accident of order. */
export let served = (
  env: object,
  lend: (plug: Plug) => Lent,
  config: Config = providing,
): Record<string, Model> => {
  let models: Record<string, Model> = {}
  for (let { plug, options, facet } of plugged(env, config)) {
    let offered = facet?.providers?.(lend(plug), options)
    for (let [name, model] of Object.entries(offered ?? {})) {
      if (models[name]) throw new Error(`two providers serve ${name}`)
      models[name] = model
    }
  }
  return models
}

/** The model `provider` serves on the platform's own lending, or, where no
 * configured plugin serves it, one that refuses every call. */
export let provided = (env: Env, provider: string): Model =>
  served(env, () => platform(env))[provider] ??
    Object.assign(
      () =>
        Promise.reject(
          new ModelError('provider', `yaks.app serves no ${provider} models`),
        ),
      { info: () => Promise.resolve(undefined) },
    )

// The names one kind of reference in a plugin's options reads.
let named = (plug: Plug, kind: keyof Reveal): string[] => {
  let found = new Set<string>()
  JSON.stringify(
    revealed(given(plug), { [kind]: (name: string) => found.add(name) }),
  )
  return [...found]
}

/** The credentials of the platform's a plugin's options carry: each
 * `{"secret": NAME}` among them the Worker holds. */
export let credentials = (env: object, plug: Plug): string[] =>
  named(plug, 'secret').filter((name) => setting(env, name))

/** Whether a plugin is named bare, its options naming nothing the Worker
 * holds: the app's own provider, called on the app's connection (config.ts
 * `serving`), where any other is the platform's. */
export let bare = (plug: Plug): boolean =>
  !named(plug, 'secret').length && !named(plug, 'binding').length

/** The sentinel of the app's connection to `integration`, which egress
 * exchanges for its key on the way to the integration's hosts, refused where
 * the app has none. */
export let connection = async (
  env: Partial<Env>,
  app: string,
  integration: string,
): Promise<string> => {
  if (!env.STORE) {
    throw new ModelError('unbound', 'This app has no integration store')
  }
  let c = ctxOf({ ...env, STORE: env.STORE })
  let link = await resolve(c, app, integration)
  if (!link) {
    let title = (await known(c.graph.read, integration))?.title ?? integration
    throw new ModelError(
      'connection',
      `Connect ${title} to this app before asking its models`,
    )
  }
  return link.sentinels[KEY.name]
}

// The plugin `config` names that serves `name`.
let serves = (env: object, name: string, config: Config) => {
  let found = plugged(env, config).find((p) => p.names.includes(name))
  if (!found) {
    throw new ModelError('provider', `yaks.app serves no ${name} models`)
  }
  return found
}

// What a hosted call carries for one of the platform's credentials.
let standing = async (env: Partial<Env>, name: string) =>
  sentinel(await vaultOf(env).salt(), 'hosted-inference:' + name)

/** An app's provider as the hosted executor is handed it (workers/model
 * `FrozenRequest`): its options with each credential of the platform's a
 * sentinel and each setting as it is, and for the app's own provider its
 * connection's sentinel. Plain data, kept in the private request. A
 * platform's provider named with credentials and given none is refused
 * before anything is bought. */
export let frozen = async (
  env: Partial<Env>,
  app: string,
  name: string,
  config: Config = serving,
): Promise<{ name: string; key: string; with: Options }> => {
  let { plug } = serves(env, name, config)
  let paid = credentials(env, plug)
  if (!bare(plug) && named(plug, 'secret').length && !paid.length) {
    throw new ModelError('unbound', `yaks.app holds no key for ${name}`)
  }
  let sentinels = new Map(
    await Promise.all(
      paid.map(async (s) => [s, await standing(env, s)] as const),
    ),
  )
  let options = revealed(given(plug), {
    secret: (s) => sentinels.get(s),
    binding: (s) => setting(env, s),
  })
  return {
    name,
    key: bare(plug) ? await connection(env, app, name) : '',
    with: JSON.parse(JSON.stringify(options)),
  }
}

/** What a hosted call of provider `name` may exchange its credentials of the
 * platform's for, and only on the way to the hosts the provider calls. */
export let granted = (
  env: Partial<Env>,
  name: string,
  config: Config = serving,
): Promise<Grant[]> => {
  let { plug, options, facet } = serves(env, name, config)
  let hosts = facet?.hosts?.(options) ?? []
  return Promise.all(
    credentials(env, plug).map(async (s) => ({
      sentinel: await standing(env, s),
      value: setting(env, s)!,
      hosts,
    })),
  )
}
