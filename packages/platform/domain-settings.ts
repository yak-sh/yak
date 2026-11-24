import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { day } from '@yaks/ui/relative'
import type { Domain, DomainApp } from './domain-pages.ts'
import { amount } from './price.ts'

export type Hostname = {
  eid: string
  name: string
  space?: string
  serves: string | null
  to: string | null
  trashed?: unknown
}

type Order = {
  order: { name: string; renews?: number }
  registered?: { expires?: string }
  refused?: string
  refunded: boolean
}

export type Registration = { expires_at: string | null; auto_renew: boolean }

export let renewal = (
  expires: string | null | undefined,
  due: number | undefined,
  credit: number,
  paid: boolean,
  now = Date.now(),
): string => {
  if (expires && Date.parse(expires) <= now) return 'Registration expired.'
  let date = expires ? day(expires, 'UTC') : ''
  let what = paid
    ? 'Renewal covered'
    : due == null
    ? 'Renewal price available closer to renewal'
    : due == 0
    ? 'Renewal included'
    : `${amount(due)} to renew${
      credit > 0 ? ' after your plan credit' : ' at the registrar’s price'
    }`
  return date ? `${what} · due by ${date}` : what
}

/** Join each hostname to its order by name, keeping pending orders visible. */
export let listings = <H extends Hostname, O extends Order>(
  hosts: H[],
  orders: O[],
  checkoutReturn?: string,
) => {
  let held = new Map(
    orders.filter((r) => r.registered).map((r) => [r.order.name, r]),
  )
  for (let attempt of orders) {
    if (
      !held.has(attempt.order.name) &&
      (!attempt.refused || attempt.order.name == checkoutReturn)
    ) {
      held.set(attempt.order.name, attempt)
    }
  }
  let byName = new Map(hosts.map((host) => [host.name, host]))
  return [...new Set([...byName.keys(), ...held.keys()])].sort().map((
    name,
  ) => ({
    name,
    hostname: byName.get(name),
    purchase: held.get(name),
  }))
}

export let domainDetails = (
  name: string,
  host: Hostname | undefined,
  purchase: Order | undefined,
  space: string,
  apps: DomainApp[],
  included: boolean,
): Domain => {
  if (!purchase?.registered && !host) {
    return {
      name,
      destination: '',
      status: purchase?.refunded
        ? 'Registration failed. Payment refunded.'
        : purchase?.refused
        ? 'Registration failed. Refund pending.'
        : 'Registration in progress.',
    }
  }
  let destination = host?.serves == space
    ? 'space'
    : apps.find((a) => a.eid == host?.serves)?.eid ?? ''
  return {
    name,
    destination,
    canTransfer: !!host && !host.trashed,
    status: host?.trashed
      ? 'In the trash'
      : destination && host?.to
      ? `Redirects to ${host.to}`
      : undefined,
    canPoint: !!host && !host.trashed && (included || !!destination),
  }
}

/** A move also ends redirects to the old destination. */
export let pointed = (
  space: string,
  host: Hostname,
  serves: string | null,
  siblings: Hostname[],
): Bundle[] => [
  {
    entity: { eid: host.eid },
    hostname: { space, serves, to: null },
    $was: {
      hostname: {
        space: token(host.space),
        serves: token(host.serves),
        to: token(host.to),
      },
      trashed: { at: null },
    },
  },
  ...siblings.filter((row) => row.to == host.name).map((row) => ({
    entity: { eid: row.eid },
    hostname: { to: null },
    $was: { hostname: { to: token(host.name) } },
  })),
]
