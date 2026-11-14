// A Plus plan space's mail at its own subdomain (D-415): `clerk@ada.yaks.app`
// beside `ada@yaks.app`. A free space keeps `<space>@yaks.app` alone.
//
// Each subdomain is a mail domain of its own at the provider (Resend allows
// no wildcard, and a name whose MX points at it without being one of its
// domains has its mail swallowed), so it is set up the first time the space
// uses mail, sending or receiving, and not before: each takes one of the
// plan's domains. We hold the zone, so the platform writes its records itself
// (zone.ts), with the space's own AAAA record beside them: the MX makes the
// name exist, and the `*.yaks.app` wildcard stops answering a name that does,
// so without it the space's pages would stop resolving. The space row then
// wears `mail_domain{name, via}`, and nothing is asked again.
//
// Where a letter there lands is post.ts `mailedTo`, the same as anywhere. A
// renamed space has its new subdomain set up at its next letter, and the
// former one stays, so mail to it keeps arriving as long as the name answers
// on the web. A space that leaves the Plus plan keeps receiving there: mail
// already on its way to a person is never dropped. Only erasing the space
// removes them.
import { spaceHost } from '@yaks/platform/host'
import type { DomainRecord } from '@yaks/host/senders'
import { caught } from './defects.ts'
import {
  type App,
  type Directory,
  paid,
  type Space,
  stamp,
} from './directory.ts'
import type { Env } from './env.ts'
import { MAIL_VIA, mailDomains } from './mail-domains.ts'
import {
  unwritten,
  written,
  type Zone,
  type ZoneRecord,
  zoneWaiting,
} from './zone.ts'

type Bound = Partial<Env> & Zone

/** The space's subdomain when its mail is set up there, or null. */
export let subdomainMail = (env: Bound, space: Space) => {
  let name = spaceHost(env, space.slug)
  return space.mail?.name == name ? name : null
}

/** An app's address at its space's subdomain, once mail is set up there:
 * its name, and every other name too for the front page, which the space's
 * own mailbox reaches for anyone not asking its Operator. */
export let subdomainBox = (
  env: Bound,
  space: Space,
  app: Pick<App, 'slug' | 'home'>,
) => {
  let name = subdomainMail(env, space)
  if (!name) return null
  return `${app.slug}@${name}` +
    (app.home ? ` and any other name at ${name}` : '')
}

// The provider's records as the zone writes them, and the space's own AAAA
// record, as the wildcard's. Each must be at or under the subdomain: a record
// at the zone's apex would be the platform's own mail.
let zoned = (name: string, records: DomainRecord[]): ZoneRecord[] => {
  let under = (n: string) => n == name || n.endsWith(`.${name}`)
  let outside = records.find((r) => !under(r.name.toLowerCase()))
  if (outside) {
    throw new Error(
      `the mail domain ${name} asks for a record at ${outside.name}, ` +
        'outside it',
    )
  }
  return [
    ...records.map((r) => ({
      type: r.type,
      name: r.name,
      content: r.value,
      ...r.priority == null ? {} : { priority: r.priority },
      ...r.type == 'CNAME' ? { proxied: false } : {},
    })),
    { type: 'AAAA', name, content: '100::', proxied: true },
  ]
}

// Setups under way in this isolate, by space, so two letters at once ask once.
let running = new Map<string, Promise<void>>()

let setUp = async (env: Bound, space: Space, name: string) => {
  let provider = await mailDomains(env)
  if (provider.waiting?.() || zoneWaiting(env)) return
  let { records } = await provider.setup(name)
  await written(env, zoned(name, records))
  // Reading asks the provider to check the records just written.
  await provider.read(name)
  await stamp(env as { STORE: NonNullable<Env['STORE']> }, {
    entities: [{
      entity: { eid: space.eid },
      mail_domain: { name, via: MAIL_VIA },
    }],
  })
}

/**
 * The space used mail: on the Plus plan, its subdomain is set up for mail if
 * it is not already. Never rejects, since a letter is never held up by it: a
 * provider or zone without its key waits silently, and any other failure is
 * reported, to be tried again at the next letter.
 */
export let usedMail = async (env: Bound, space: Space) => {
  if (!paid(space.tier) || space.trashed || !env.STORE) return
  if (subdomainMail(env, space)) return
  let name = spaceHost(env, space.slug)
  let held = running.get(space.eid)
  if (!held) {
    held = setUp(env, space, name)
      .catch((why) =>
        caught(why, { request: 'subdomain mail', space: space.slug })
      )
      .finally(() => running.delete(space.eid))
    running.set(space.eid, held)
  }
  await held
}

/**
 * Remove the space's subdomain mail domains, its current subdomain's and
 * each former one no other space has taken since, with their records. For
 * erasing a space (erase.ts); rejects when the provider or the zone refuses,
 * so the erase stops before the space row goes.
 */
export let unmailSpace = async (
  env: Bound,
  dir: Pick<Directory, 'space'>,
  space: Space,
) => {
  if (!space.mail) return
  let provider = await mailDomains(env, space.mail.via)
  if (provider.waiting?.() || zoneWaiting(env)) return
  for (let slug of [space.slug, ...space.slugs]) {
    let holder = slug == space.slug ? space : await dir.space(slug)
    if (holder && holder.eid != space.eid) continue
    let name = spaceHost(env, slug)
    let got = await provider.read(name)
    if (!got) continue
    await provider.remove(name)
    await unwritten(env, zoned(name, got.records))
  }
}
