// The directory's ports for the domains people buy (@yaks/domains): its
// registry is Cloudflare Registrar on the platform's account, its graph is
// the directory's own, a bought name is attached the way domain_attach
// attaches one (a hostname row and its custom hostname, mail beside it), and
// the records that takes are written into the name's own zone, which is
// ours, so the person adds none. Ownership needs no TXT lookup: we hold the
// name, and the row is marked verified as it is attached.
//
// A registration still running, or a call Cloudflare or Stripe failed, runs
// again (`retry`) until it ends. An order that can't be registered is
// refunded through the payments provider (payments.ts), keyed by its
// checkout so it is refunded once; one Cloudflare refused after a live
// payment is also reported, since nothing should have let it be sold.
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { line } from '@yaks/query'
import { fulfil, type Ports, type Rec, renew, Waiting } from '@yaks/domains'
import { ceilings, paid, type Tier } from '@yaks/platform/plans'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import type { MailDomain } from '../directory.ts'
import { customOf, provision, records, registryOf } from '../domains.ts'
import { placed, setUp } from '../domain-mail.ts'
import { written } from '../zone.ts'
import { caught, defect } from '../defects.ts'
import { plans } from '../payments.ts'

type Graph = Ports['graph']

// A bought name attached to its place, and every record that takes.
let attach =
  (env: Env, graph: Graph) => async (name: string, serves: string) => {
    let at = new Date().toISOString()
    let [held] = await graph.read(line`.hostname.name=${name}`)
    let row = held?.hostname as { serves?: string } | undefined
    if (row && row.serves != serves) {
      throw new Error(
        `${name} was bought for ${serves} and serves ${row.serves}`,
      )
    }
    let eid = held?.entity.eid ?? crypto.randomUUID()
    let mail = held?.mail_domain as MailDomain | undefined ??
      await placed(env, name)
    if (!held) {
      await graph.apply([{
        entity: { eid },
        hostname: { name, serves, stage: 'pending', verification: {}, at },
        mail_domain: mail,
      }])
    }
    let custom = await customOf(env, name) ?? await provision(env, name)
    let verification = custom.ownership_verification ?? {}
    await graph.apply([{
      entity: { eid },
      hostname: { verification, at },
      verified: { at },
    }])
    let m = await setUp(env, mail)
    return [
      ...records(name, env, verification).map((r): Rec => ({
        type: r.type,
        name: r.name,
        content: r.value,
        ...r.type == 'CNAME' ? { proxied: false } : {},
      })),
      ...m.records.map((r): Rec => ({
        type: r.type,
        name: r.name,
        content: r.value,
        ...r.priority == null ? {} : { priority: r.priority },
      })),
    ]
  }

// Whether a space's plan pays for its domains: a paid tier, or a space the
// platform comps, as domain_attach decides.
let paying = (graph: Graph) => async (space: string) => {
  let [row] = await graph.read(line`.entity.eid=${space}`)
  let tier = (row?.plan as { tier?: Tier } | undefined)?.tier ?? null
  let slug = (row?.space as { slug?: string } | undefined)?.slug
  return paid(tier) || !ceilings(tier, slug)
}

/** The ports @yaks/domains reaches the platform through, from inside the
 * directory. */
export let ports = (env: Env, graph: Graph): Ports => ({
  registry: registryOf(env),
  graph,
  paying: paying(graph),
  attach: attach(env, graph),
  write: (zone, recs) =>
    written({
      CF_ZONE: zone,
      CF_DNS_TOKEN: env.CF_REGISTRAR_TOKEN,
      HOSTNAMES_API: env.HOSTNAMES_API,
    }, recs),
  refund: async (order) =>
    (await (await plans(env)).refunded({
      key: `domain-refund|${order.checkout}`,
      checkout: order.checkout,
      tags: { domain: order.name, space: order.space },
    })).id,
})

// Runs again in a minute, or as long as a waiting registration asks.
let again = (error: unknown) =>
  Object.assign(
    error instanceof Error ? error : new Error(String(error)),
    error instanceof Waiting ? {} : { retry: { after: 60_000 } },
  )

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  let env = at.env as Env
  if (!at.meta) return {}
  let graph: Graph = {
    read: async (q) => await at.graph.read(q) as Bundle[],
    apply: async (bundles) => await at.graph.apply(bundles, { trusted: true }),
  }
  return {
    register_domain: async (event, _tx, _write, attempt) => {
      try {
        let done = await fulfil(ports(env, graph), event.entity.eid)
        if (done.done == 'refunded' && done.order.live) {
          defect(
            new Error(
              `${done.order.name} was paid for and could not be registered ` +
                `(${done.why}); its ${done.order.cents} cents were refunded`,
            ),
            { request: 'register_domain', order: event.entity.eid },
          )
        }
      } catch (error) {
        // Waiting is the workflow running, not a failure, until it needs a
        // person.
        if (
          !(error instanceof Waiting) ||
          error.registration.state == 'action_required'
        ) {
          caught(error, { request: 'register_domain', order: event.entity.eid })
        }
        await attempt?.progressed()
        throw again(error)
      }
    },
    renew_domains: async (event, _tx, _write, attempt) => {
      try {
        await renew(ports(env, graph), event.entity.eid)
      } catch (error) {
        caught(error, { request: 'renew_domains', space: event.entity.eid })
        await attempt?.progressed()
        throw again(error)
      }
    },
  }
}
