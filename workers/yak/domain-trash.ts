// Hostnames are shared names: keep the provider's claim and mail while trashed.
import type { Kind } from './confirm.ts'
import type { Directory, Host } from './directory.ts'
import { release } from './domains.ts'
import { unmail } from './domain-mail.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'

export let binnedDomain = async (dir: Directory, host: Host, who: Who) => {
  if (!host.trashed) {
    await dir.apply(
      { entities: [{ entity: { eid: host.eid }, trashed: {} }] },
      vouched(who),
    )
  }
  return `${host.name} is in the trash. Its hostname, certificate and mail domain ` +
    'stay held so it can be restored. domain_attach with the same hostname restores it. ' +
    'Only the owner can permanently release it, through the confirmation page ' +
    'requested by domain_detach with purge: true.'
}

export let trashedDomain: Kind<Host> = {
  kind: 'domainerase',
  find: async (dir, space, target) =>
    (await dir.hosts(space)).find((h) => h.eid == target) ?? null,
  typed: (h) => h.name,
  title: (h) => `Release ${h.name} for good?`,
  until: () =>
    'Its hostname, certificate and mail domain remain held in the trash.',
  stop: (h) => h.trashed ? '' : 'Move this domain to the trash first.',
  lines: (_space, h) => [
    `${h.name}'s attachment and certificate, which another space may then claim`,
    ...h.mail ? [`its mail domain at ${h.mail.name}`] : [],
    'the chance to restore the attachment from the trash',
  ],
  press: (h) => `Release ${h.name} forever`,
  act: async (env, dir, space, h, who) => {
    await release(env, h.name)
    let failed = await unmail(env, h.mail)
    if (failed) {
      throw new Error(`could not remove ${h.name}'s mail domain: ${failed}`)
    }
    let senders = (await dir.hosts(space)).filter((s) => s.to == h.name)
    await dir.apply({
      entities: [
        { entity: { eid: h.eid }, tombstone: {} },
        ...senders.map((s) => ({
          entity: { eid: s.eid },
          hostname: { to: null },
        })),
      ],
    }, vouched(who))
    await dir.purgeTrashEntities([h.eid])
    return `${h.name} is permanently released. Remove its DNS records wherever its DNS is managed.`
  },
}
