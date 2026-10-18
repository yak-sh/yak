/** Populated dashboard fixtures and assertions. The kernel still owns routing,
 * directory reads and rendering; only the external analytics answer is local. */
import { connector, meta, onPlus } from '../workers/yak/probe.ts'
import type { Kernel } from '../workers/yak/probe.ts'

export let VIEWS = [
  'apps',
  'settings',
  'connections',
  'trash',
  'billing',
  'connect',
  'people',
  'new',
  'visits',
  'selling',
] as const

export let management = async (k: Kernel) => {
  let space = 'bench-management'
  let agent = connector(k, k.owner.cookie)
  let dir = meta(k)
  await agent.tool('space_new', { slug: space, title: 'Management waits' })
  await agent.tool('app_new', {
    space,
    slug: 'notes',
    title: 'Management notes',
  })
  await agent.tool('app_new', {
    space,
    slug: 'discarded',
    title: 'Discarded notes',
  })
  await agent.tool('app_delete', { space, app: 'discarded' })
  await agent.tool('member_add', {
    space,
    email: 'waiting@bench.invalid',
    role: 'editor',
  })
  let [row] = await dir.query(`.space.slug=${space} ?plan ?stripe`)
  await onPlus(k, String(row.entity.eid))
  let path = (view: string) =>
    `/manage${view == 'apps' ? '' : '/' + view}?space=${space}`
  let seller = await k.at(k.host, path('selling'), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: k.owner.cookie,
      origin: `https://${k.host}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ sell: 'start' }),
  })
  if (seller.status != 303) {
    throw new Error('management seller setup ' + await seller.text())
  }
  await seller.body?.cancel()
  let wanted: Record<string, string> = {
    apps: 'Management notes',
    settings: 'name="name"',
    connections: 'Management API',
    trash: 'Discarded notes',
    billing: 'data-door="portal"',
    connect: 'Your agents',
    people: 'waiting@bench.invalid',
    new: 'Upload your website',
    visits: 'Stats_Chart',
    selling: 'Payments are connected',
  }
  let r = await k.at(k.host, path('connections'), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: k.owner.cookie,
      origin: `https://${k.host}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      do: 'add',
      integration: 'Management API',
      hosts: 'api.management.invalid',
      key: 'local-only-dummy-key',
    }),
  })
  let text = await r.text()
  if (r.status != 200 || !text.includes('Saved.')) {
    throw new Error('management fixture connection not saved')
  }
  let visible: Record<string, string> = {
    apps: 'Management notes',
    settings: 'Settings',
    connections: 'Management API',
    trash: 'Discarded notes',
    billing: 'Billing',
    connect: 'ChatGPT',
    people: 'waiting@bench.invalid',
    new: 'Upload your website',
    visits: '42',
    selling: 'Payments are connected',
  }
  let ready = Object.fromEntries(VIEWS.map((v) => [v, 'true']))
  ready.settings = "!!document.querySelector('input[name=name]')"
  ready.visits = "!!document.querySelector('.Stats_Chart')"
  ready.billing = "!!document.querySelector('[data-door=portal]')"
  ready.trash =
    "!!document.querySelector('input[name=restore][value=discarded]')"
  ready.connect =
    "document.querySelector('main')?.textContent.includes('ChatGPT')"
  return { space, path, wanted, visible, ready }
}
