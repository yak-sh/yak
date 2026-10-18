// Which provider serves a model, read off the graph's `serves` edges. The
// implementations are the host's, keyed by `provider.name`: the runner is lent
// them (./run.ts `Runner`), and these say which of them answers a `using`.
//
// A transcript whose `using` names a provider this host has no implementation
// for is not refused here — it is somebody else's to answer: a command-line
// agent @yaks/spawn launches, or another host lent that provider.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import {
  confirmed,
  type Executor,
  type Listed,
  type Model,
  ModelError,
  prefixCacheMark,
} from '@yaks/model'
import type { Served } from './react.ts'

/** One provider's offering of a model: who serves it, under what name, and
 * the implementation this host has for that provider (if any). */
export type Offer = {
  provider: Eid
  model: Eid
  name: string
  serve?: Model
}

/** Every `serves` edge that points at a model, each with the implementation
 * this host has for its provider. */
export let offers = async (
  g: Graph,
  model: Eid,
  implementations: Readonly<Record<string, Model>>,
): Promise<Offer[]> => {
  let edges = await g.read(`.serves .edge.to=${model}`)
  let froms = edges.map((b) => String((b.edge as Comp).from))
  let rows = froms.length ? await g.get(froms) : []
  let named = new Map(
    rows.filter(Boolean).map((b) => [
      b.entity.eid,
      (b.provider as Comp | undefined)?.name,
    ]),
  )
  return edges.map((b, i) => {
    let provider = named.get(froms[i])
    return {
      provider: froms[i],
      model,
      name: String((b.serves as Comp).name ?? ''),
      serve: typeof provider == 'string' &&
          Object.hasOwn(implementations, provider)
        ? implementations[provider]
        : undefined,
    }
  })
}

/** The offer a `using` resolves to: the named provider's, which must serve the
 * model, or else the one provider this host can reach that serves it. */
export let offerFor = (
  all: Offer[],
  provider?: unknown,
): Offer | string => {
  if (provider != null) {
    let named = all.find((o) => o.provider == provider)
    if (!named) return 'The selected provider does not serve this model'
    return named.serve
      ? named
      : 'No implementation configured for the selected provider'
  }
  let reachable = all.filter((o) => o.serve)
  if (reachable.length == 1) return reachable[0]
  return reachable.length
    ? 'Several providers serve this model; name one'
    : 'No implementation configured for a provider of this model'
}

/** The resolver a runner asks with (./react.ts `Deps.resolveModel`). One
 * `override` for every provider (a test's, an embedder's) still asks by the
 * provider's name for the model, and still refuses a provider that does not
 * serve it; a model nobody serves is asked by its own name. */
export let providerResolver = (
  g: Graph,
  implementations: Readonly<Record<string, Model>>,
  override?: Model,
  executorFor?: (provider: string) => Promise<Executor | undefined>,
  report?: (error: unknown) => void,
): (using: Comp | undefined, model: Bundle) => Promise<Served> => {
  // A resolver lives with its runner. Share discovery across simultaneously
  // resumed transcripts, not just requests for the same selected model. An
  // empty catalog is a result too; catalogs need not supply prices at all.
  let catalogs = new WeakMap<
    Model,
    Map<string, {
      until: number
      value: Promise<Listed[]>
    }>
  >()
  let describeOnce = (serve: Model, name?: string): Promise<Listed[]> => {
    let key = name ?? ''
    let cache = catalogs.get(serve)
    if (!cache) catalogs.set(serve, cache = new Map())
    let kept = cache.get(key)
    if (kept && kept.until > Date.now()) return kept.value
    let entry = {
      until: Infinity,
      value: Promise.resolve([] as Listed[]),
    }
    cache.set(key, entry)
    entry.value = Promise.resolve().then(async () => {
      try {
        let listed = name == null
          ? await serve.list?.() ?? []
          : [await serve.info?.(name)].filter((m): m is Listed => !!m)
        entry.until = Date.now() + 300_000
        return listed
      } catch (error) {
        if (error instanceof ModelError && !error.retry) {
          cache.delete(key)
          throw error
        }
        // Discovery is optional preparation, not a paid model request. An
        // exhausted transient outage must not fail the session; cool down even
        // when the endpoint returns no metadata, and report the lost enrichment.
        entry.until = Date.now() + Math.max(
          60_000,
          error instanceof ModelError ? error.retry?.after ?? 0 : 0,
        )
        report?.(error)
        return []
      }
    })
    return entry.value
  }
  return async (using, model) => {
    let all = await offers(g, model.entity.eid, implementations)
    if (using?.provider && !all.some((o) => o.provider == using.provider)) {
      let [row] = await g.get([String(using.provider)])
      let provider = String((row?.provider as Comp | undefined)?.name ?? '')
      all.push({
        provider: String(using.provider),
        model: model.entity.eid,
        name: String((model.model as Comp).name),
        serve: implementations[provider],
      })
    }
    let found = override && using?.provider == null
      ? {
        serve: override,
        provider: all[0]?.provider ?? String(using?.provider ?? ''),
        name: all[0]?.name ?? String((model.model as Comp).name),
      }
      : offerFor(
        override ? all.map((o) => ({ ...o, serve: override })) : all,
        using?.provider,
      )
    if (typeof found == 'string') {
      let refuse: Model = () =>
        Promise.reject(new ModelError('provider', found))
      return { model: refuse, name: String((model.model as Comp).name) }
    }
    let serve = found.serve!
    let describe = async () => {
      let [current] = await g.get([model.entity.eid])
      // Listing all names is useful only for a newly requested model. A missing
      // price is not evidence that a catalog is missing: OpenAI never lists one.
      if (!current?.pending && (current?.price || !serve.info)) return undefined
      return (await describeOnce(serve, serve.info ? found.name : undefined))
        .find((m) => m.name == found.name)
    }
    let prepare = (req: Parameters<Model>[0], listing?: Listed) => {
      let modalities = listing?.modalities?.filter(
        (m): m is 'text' | 'image' | 'audio' =>
          m == 'text' || m == 'image' || m == 'audio',
      )
      return {
        ...req,
        ...!req.modalities && modalities?.length ? { modalities } : {},
      }
    }
    let confirm = async (listing?: Listed) => {
      if (
        found.provider &&
        (model.pending || !all.some((o) => o.provider == found.provider))
      ) {
        await g.apply(
          confirmed(
            found.provider,
            String((model.model as Comp).name),
            listing,
          ),
          { trusted: true },
        )
      }
    }
    let wrapped: Model = Object.assign(async (req: Parameters<Model>[0]) => {
      let listing = await describe()
      // Read retention per dispatch, not at startup or completion. The answer's
      // explicit expiry wins; unknown providers must not inherit another TTL.
      let [providerRow] = found.provider
        ? await g.get([found.provider], ['provider'])
        : []
      let cache = {
        requestedAt: Date.now(),
        retention: (providerRow?.provider as Comp | undefined)?.cache_retention,
      }
      let reply = await serve(prepare(req, listing))
      await confirm(listing)
      return {
        ...reply,
        cacheExpiresAt: prefixCacheMark(reply, cache).cache_expires_at,
      }
    }, serve)
    let executor: Executor | undefined
    if (executorFor) {
      let [provider] = await g.get([found.provider], ['provider'])
      executor = await executorFor(
        String((provider?.provider as Comp | undefined)?.name ?? ''),
      )
    }
    let listing: Listed | undefined
    return {
      model: wrapped,
      name: found.name,
      provider: found.provider,
      ...executor
        ? {
          executor: {
            ...executor,
            submit: async (call, req) => {
              listing = await describe()
              // Metadata is free preparation; pricing must survive a Store restart
              // so settlement can weigh a provider that does not report dollars.
              if (listing) {
                let { price, ...named } = listing
                await g.apply([{
                  entity: model.entity,
                  model: { ...named, name: String((model.model as Comp).name) },
                  ...price ? { price } : {},
                }], { trusted: true })
              }
              await executor.submit(call, prepare(req, listing))
            },
            resume: async (call) => {
              let reply = await executor.resume(call)
              if (reply) await confirm(listing)
              return reply
            },
          },
        }
        : {},
    }
  }
}

/** Whether this host answers a transcript asking with `using`: the provider
 * it names is one this host has an implementation for, or it names none and
 * the model is one a provider this host reaches serves. An `override` answers
 * every provider but a command line (`transport: process`), which is
 * @yaks/spawn's to launch, and a `using` naming nothing at all.
 *
 * ```ts
 * import { answers } from '@yaks/session'
 *
 * // if (await answers(graph, { openai })(using)) …
 * ```
 */
export let answers = (
  g: Graph,
  implementations: Readonly<Record<string, Model>>,
  override?: Model,
) =>
async (using: Comp | undefined, session?: Eid): Promise<boolean> => {
  let provider = using?.provider
  if (provider != null) {
    let [row] = await g.get([String(provider)])
    let named = row?.provider as Comp | undefined
    if (!named) return false
    if (named.transport == 'process') {
      let [owner] = session ? await g.get([session], ['native']) : []
      if (!owner?.native) return false
    }
    if (override) return named.transport != 'process'
    return typeof named.name == 'string' &&
      Object.hasOwn(implementations, named.name)
  }
  if (override) return true
  if (using?.model == null) return false
  let all = await offers(g, String(using.model), implementations)
  return all.some((o) => o.serve)
}
