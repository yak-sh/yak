// Resend's Domains API at @yaks/host's neutral mail domain boundary. A caller
// names a domain by its name; Resend's id for it is looked up here at each
// call and never leaves this file. Setting a domain up needs a `full_access`
// key, which a sending key is not.
import type { DomainRecord, MailDomain, MailDomains } from '@yaks/host/senders'
import { type Fetch, root, said } from './api.ts'

/** The key domains are set up with and the HTTP boundary, from the host. */
export type Domains = { token: string; base?: string; fetch?: Fetch }

// A domain as Resend answers one. A record's name is relative to the zone it
// is written in, as `send.bot` is for bot.yak.sh, or names the zone as `@`.
type Answered = {
  id: string
  name: string
  capabilities?: { sending?: string; receiving?: string }
  records?: {
    type: string
    name: string
    value: string
    priority?: number | null
    status: string
  }[]
}

// The domain's leading labels that are not its zone: the longest that every
// relative name ends with, since each record sits at or under the domain.
let under = (domain: string, names: string[]) => {
  if (!names.length) return ''
  let labels = domain.split('.')
  for (let n = labels.length - 1; n > 0; n--) {
    let lead = labels.slice(0, n).join('.')
    if (names.every((name) => name == lead || name.endsWith(`.${lead}`))) {
      return lead
    }
  }
  return ''
}

/** A domain's records as fully qualified names, each `arrived` once Resend
 * has verified it.
 *
 * ```ts
 * import { shaped } from '@yaks/resend/domains'
 * import { equal } from '@yaks/testing'
 *
 * let record = (name: string, status = 'verified') =>
 *   ({ type: 'TXT', name, value: 'v', status })
 * equal(
 *   shaped({
 *     id: 'r',
 *     name: 'bot.yak.sh',
 *     records: [record('resend._domainkey.bot'), record('bot', 'pending')],
 *   }).records.map(({ name, arrived }) => [name, arrived]),
 *   [['resend._domainkey.bot.yak.sh', true], ['bot.yak.sh', false]],
 * )
 * ```
 */
export let shaped = (domain: Answered): MailDomain => {
  let name = domain.name.toLowerCase(), records = domain.records ?? []
  let fq = (one: string) => one == name || one.endsWith(`.${name}`)
  let relative = records.map((r) => r.name).filter((n) => n != '@' && !fq(n))
  let lead = under(name, relative)
  let zone = lead ? name.slice(lead.length + 1) : name
  return {
    name,
    records: records.map((r): DomainRecord => ({
      type: r.type,
      name: r.name == '@' || !r.name
        ? zone
        : fq(r.name)
        ? r.name
        : `${r.name}.${zone}`,
      value: r.value,
      ...(r.priority != null ? { priority: r.priority } : {}),
      arrived: r.status == 'verified',
    })),
  }
}

let both = { sending: 'enabled', receiving: 'enabled' }

/** Resend's mail domains: `setup` adds a domain with sending and receiving
 * on (or turns on whichever an existing one lacks), `read` answers its
 * records and starts Resend's check of them when some have not arrived and
 * no check is under way, and `remove` deletes it. A refusal rejects with the
 * status, Resend's code and its message, which for a domain names no secret. */
export let domains = (
  { token, base, fetch: call }: Domains,
): MailDomains => {
  let ask = async <T>(
    what: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    let response = await (call ?? fetch)(`${root(base)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      let { name, message } = await said(response)
      throw new Error(
        `Resend refused to ${what} (HTTP ${response.status}` +
          (name ? ` ${name}` : '') + ')' +
          (message ? `: ${message.slice(0, 200)}` : ''),
      )
    }
    return await response.json() as T
  }
  let path = (id: string) => `/domains/${encodeURIComponent(id)}`
  let find = async (name: string) => {
    let { data } = await ask<{ data: Answered[] }>(
      `list domains`,
      'GET',
      '/domains',
    )
    return data.find((d) => d.name.toLowerCase() == name.toLowerCase())
  }
  let get = (id: string, name: string) =>
    ask<Answered>(`read ${name}`, 'GET', path(id))
  return {
    setup: async (name) => {
      let found = await find(name)
      if (!found) {
        return shaped(
          await ask<Answered>(`set up ${name}`, 'POST', '/domains', {
            name,
            capabilities: both,
          }),
        )
      }
      let on = found.capabilities ?? {}
      if (on.sending != 'enabled' || on.receiving != 'enabled') {
        await ask(`set up ${name}`, 'PATCH', path(found.id), {
          capabilities: both,
        })
      }
      return shaped(await get(found.id, name))
    },
    read: async (name) => {
      let found = await find(name)
      if (!found) return undefined
      let domain = await get(found.id, name)
      let records = domain.records ?? []
      if (
        records.some((r) => r.status != 'verified') &&
        !records.some((r) => r.status == 'pending')
      ) await ask(`check ${name}`, 'POST', `${path(found.id)}/verify`)
      return shaped(domain)
    },
    remove: async (name) => {
      let found = await find(name)
      if (found) await ask(`remove ${name}`, 'DELETE', path(found.id))
    },
  }
}

/** The domains of a key set at the call, or the same verbs rejecting with
 * why they cannot be reached until it is: `options` are read at each call,
 * so a key put after start-up is used by the next one. */
export let lent = (options: () => Partial<Domains>): MailDomains => {
  let missing =
    'waiting for credentials: Resend mail domains need `domains.token`'
  let made = () => {
    let { token, ...rest } = options()
    if (!token) throw new Error(missing)
    return domains({ ...rest, token })
  }
  return {
    setup: async (name) => await made().setup(name),
    read: async (name) => await made().read(name),
    remove: async (name) => await made().remove(name),
    waiting: () => options().token ? undefined : missing,
  }
}
