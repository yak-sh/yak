// App Stores use the runtime's directory even when a cost probe measures a
// separate directory Store. Give both the same app and owner's standing.
import type { App, Space } from './directory.ts'
import type { Namespace } from './door.ts'
import { KERNEL, meta } from './meta.ts'

export let directoryStanding = async (
  namespace: Namespace,
  space: Space,
  app: App,
  person: string,
) => {
  let { eid: spaceId, slug: spaceSlug } = space
  let { eid: appId, slug, access, store, version } = app
  await meta({ STORE: namespace }).apply([
    { entity: { eid: person }, person: {} },
    { entity: { eid: spaceId }, space: { slug: spaceSlug } },
    {
      entity: { eid: appId },
      app: { space: spaceId, slug, access, store, version },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: spaceId, role: 'owner' },
    },
  ], KERNEL)
}
