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
  current: Registration | null,
  expires: string | undefined,
  included: boolean,
  now = Date.now(),
) => {
  let ends = current?.expires_at ?? expires
  let on = current?.auto_renew ?? included
  if (current?.expires_at && Date.parse(current.expires_at) <= now) {
    return 'Registration expired.'
  }
  let date = ends ? day(ends, 'UTC') : ''
  if (on) {
    return date
      ? `Renews by ${date} · $0 extra with your plan`
      : 'Renewal costs $0 extra with your plan'
  }
  return date ? `Expires ${date} · auto-renew off` : 'Auto-renew off'
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
    price: purchase?.order.renews != null
      ? `${
        amount(purchase.order.renews)
      } per year at the registrar (quote at purchase).`
      : purchase?.registered
      ? 'Registrar renewal price unavailable.'
      : undefined,
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
