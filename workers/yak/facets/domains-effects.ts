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
import {
  fulfil,
  type Placed,
  type Ports,
  type Rec,
  renew,
  Waiting,
} from '@yaks/domains'
import {
  choiceOf,
  nextRenewal,
  optedIn,
  prepareRenewal,
} from '../domain-renewal.ts'
import { inStore } from './directory-effects.ts'
import type { Directory } from '../directory.ts'
import type { Options } from './store.ts'
import type { Env } from '../env.ts'
import type { MailDomain } from '../directory.ts'
import {
  customOf,
  provision,
  records,
  registrationOf,
  registryOf,
} from '../domains.ts'
import { placed, setUp } from '../domain-mail.ts'
import { written } from '../zone.ts'
import { caught, defect } from '../defects.ts'
import { plans } from '../payments.ts'

type Graph = Ports['graph']

// A bought name attached to its place, and every record that takes.
let attach =
  (env: Env, graph: Graph) =>
  async (name: string, serves: string | undefined, space: string) => {
    let at = new Date().toISOString()
    let [held] = await graph.read(line`.hostname.name=${name}`)
    let row = held?.hostname as { serves?: string; space?: string } | undefined
    if (row && (row.space ? row.space != space : row.serves != serves)) {
      throw new Error(`${name} is already held by another space`)
    }
    let eid = held?.entity.eid ?? crypto.randomUUID()
    let mail = held?.mail_domain as MailDomain | undefined ??
      await placed(env, name)
    if (!held) {
      await graph.apply([{
        entity: { eid },
        hostname: {
          name,
          space,
          ...serves ? { serves } : {},
          stage: 'pending',
          verification: {},
          at,
        },
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

let paying =
  (env: Env, dir: Directory): Ports['paying'] => async (order, eid) => {
    let space = await dir.at(order.space)
    if (!space || space.trashed) return false
    let orders = await dir.domainOrders(space)
    let purchase = orders.find((r) => r.eid == eid)
    if (!purchase?.registered) return false
    let terms = await choiceOf(env, space, orders)
    let status = await registrationOf(env, order.name)
    let expires = status?.expires_at ?? purchase.registered.expires
    return optedIn(
      purchase,
      terms.for(purchase, expires),
      expires,
      env.CLOCK?.now() ?? Date.now(),
    )
  }

/** The ports @yaks/domains reaches the platform through, from inside the
 * directory. */
export let ports = (env: Env, graph: Graph, dir: Directory): Ports => ({
  registry: registryOf(env),
  graph,
  paying: paying(env, dir),
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
  let dir = inStore(at)
  let p = ports(env, graph, dir)
  let reconcile = async (eid: string, now = env.CLOCK?.now() ?? Date.now()) => {
    let space = await dir.at(eid)
    if (!space) return
    for (let order of await dir.domainOrders(space)) {
      if (order.registered && !space.trashed) {
        await prepareRenewal(env, dir, space, order, now)
      }
    }
    await renew(p, eid)
  }
  let change = async (
    space: string,
    attempt: { progressed: () => Promise<void> } | undefined,
  ) => {
    try {
      await reconcile(space)
    } catch (error) {
      caught(error, { request: 'renew_domains', space })
      await attempt?.progressed()
      throw again(error)
    }
  }
  return {
    register_domain: async (event, _tx, _write, attempt) => {
      try {
        let done = await fulfil(p, event.entity.eid)
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
    renew_transferred_domain: async (event, _tx, _write, attempt) => {
      let [row] = await graph.read(
        line`.entity.eid=${event.entity.eid}&.domain_transfer`,
      )
      let transfer = row?.domain_transfer as
        | { from: string; to: string }
        | undefined
      if (!transfer) return
      // Switch the receiving space off its former choice before enabling the
      // source's new choice, so a transferred name never counts twice.
      await change(transfer.to, attempt)
      await change(transfer.from, attempt)
    },
    renew_domain_order: async (event, _tx, _write, attempt) => {
      let [row] = await graph.read(
        line`.entity.eid=${event.entity.eid}&.domain_order`,
      )
      if (row?.domain_order) {
        await change((row.domain_order as Placed).space, attempt)
      }
    },
    renew_domains: async (event, _tx, _write, attempt) =>
      await change(event.entity.eid, attempt),
    domain_renewals_due: async () => {
      let due = new Set(
        (await graph.read(nextRenewal)).map((row) =>
          (row.domain_order as Placed).space
        ),
      )
      for (let eid of due) {
        try {
          await reconcile(eid)
        } catch (error) {
          caught(error, { request: 'annual domain renewals', space: eid })
        }
      }
    },
  }
}
