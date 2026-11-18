// A delete migration retires a namespace under a unique class name. Only the
// owner's confirmation sends deleted_classes to Cloudflare, against the exact
// remote migration tag the request named. Reusing the original class is safe.
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import { sleep } from '@yaks/fp'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { type Kind, requested } from './confirm.ts'
import { confirmedTag, type Retirement } from './app_migrations.ts'
import { answered, moduleType, sent } from './dispatch.ts'
import { held, retained, tags } from './rewrap.ts'
import { KERNEL, meta } from './meta.ts'
import { WRAPPER } from './wrangler_app.ts'
import { fenced, unfenced, waiting } from './versions.ts'
import { vouched, type Who } from './session.ts'

export type Pending = {
  eid: string
  app: App
  script: string
  tag: string
  classes: Retirement[]
}

/** The immutable request; another migration needs another request. */
export let retirementRequested = async (
  env: Env,
  app: App,
  script: string,
  uploaded: { retired: Retirement[]; archives: string[]; tag?: string },
) => {
  if (!uploaded.archives.length || !uploaded.tag) return null
  let previous = await meta(env).query(
    line`.durable_retirement.app=${app.eid}&.durable_retirement.script=${script}&!completed`,
  )
  let classes = new Map<string, Retirement>()
  for (let row of previous) {
    for (
      let c of (row.durable_retirement as { classes: Retirement[] }).classes
    ) classes.set(c.to, c)
  }
  for (let c of uploaded.retired) classes.set(c.to, c)
  let retained = [...classes.values()].filter((c) =>
    uploaded.archives.includes(c.to)
  )
  if (!retained.length) return null
  let pending: Pending = {
    eid: derivedEid(
      JSON.stringify(['yak/durable-retirement', app.eid, script, uploaded.tag]),
    ),
    app,
    script,
    tag: uploaded.tag,
    classes: retained,
  }
  await meta(env).apply([{
    entity: { eid: pending.eid },
    durable_retirement: {
      app: app.eid,
      script,
      tag: pending.tag,
      classes: pending.classes,
    },
  }], KERNEL)
  return pending
}

export let retirementLetter = async (
  env: Env,
  dir: Directory,
  space: Space,
  t: Pending,
) => {
  let owners = await dir.members(space)
  let owner = await Promise.all(
    owners.map(async (person) =>
      await dir.role(space, person) == 'owner' ? person : null
    ),
  )
  let letters = await Promise.all(
    owner.filter((p) => p != null).map((person) =>
      requested(env, dir, space, person, retiredStorage, t.eid, t)
    ),
  )
  return letters[0] ??
    'The retired storage is kept until a space owner confirms deletion.'
}

let current = async (env: Env, script: string) => {
  let r = await sent(env, `/${script}`, { method: 'GET' })
  if (r.status == 404) {
    await r.body?.cancel()
    return null
  }
  let details = await answered(r) as { script?: { migration_tag?: string } }
  return details?.script?.migration_tag ?? null
}

let completed = async (env: Env, t: Pending, who: Who) => {
  await meta(env).apply([{
    entity: { eid: t.eid },
    completed: { at: new Date().toISOString() },
  }], { ...KERNEL, ...vouched(who) })
  return `The retired ${
    t.classes.map((c) => c.from).join(', ')
  } storage is erased. The app's current classes are unchanged.`
}

let erased = async (env: Env, t: Pending, who: Who) => {
  let tag = await current(env, t.script)
  if (tag == confirmedTag(t.tag, t.eid)) return completed(env, t, who)
  if (tag != t.tag) {
    return 'The app migrated again. No storage was deleted by this confirmation; deploy again to request a current confirmation.'
  }
  let [modules, settings, worn] = await Promise.all([
    held(env, t.script, sleep),
    sent(env, `/${t.script}/settings`, {}).then(answered),
    tags(env, t.script, sleep),
  ])
  if (await current(env, t.script) != t.tag) {
    return 'The app migrated again. No storage was deleted by this confirmation; deploy again to request a current confirmation.'
  }
  let body = new FormData()
  body.append(
    'metadata',
    new Blob([JSON.stringify({
      ...retained(settings as Parameters<typeof retained>[0]),
      main_module: WRAPPER,
      tags: worn,
      migrations: {
        old_tag: t.tag,
        new_tag: confirmedTag(t.tag, t.eid),
        steps: [{ deleted_classes: t.classes.map((c) => c.to) }],
      },
    })], { type: 'application/json' }),
  )
  for (let m of modules) {
    let bytes = m.bytes
    if (m.name == WRAPPER) {
      let source = new TextDecoder().decode(bytes)
      for (let { to } of t.classes) {
        source = source.replace(
          new RegExp(`^export class ${to} \\{.*\\}\\n?`, 'm'),
          '',
        )
      }
      bytes = new TextEncoder().encode(source)
    }
    body.append(m.name, new Blob([bytes], { type: moduleType(m.name) }), m.name)
  }
  await answered(await sent(env, `/${t.script}`, { method: 'PUT', body }))
  return completed(env, t, who)
}

export let retiredStorage: Kind<Pending> = {
  kind: 'storage',
  find: async (dir, space, eid, env) => {
    let [row] = await meta(env).query(
      line`.entity.eid=${eid}&.durable_retirement&!completed`,
    )
    if (!row) return null
    let p = row.durable_retirement as {
      app: string
      script: string
      tag: string
      classes: Retirement[]
    }
    let app = (await dir.apps(space)).find((a) => a.eid == p.app)
    return app ? { ...p, eid, app } : null
  },
  typed: (t) => t.app.slug,
  title: (t) => `Erase retired storage from ${t.app.title || t.app.slug}?`,
  until: () =>
    'The app deployed. Its retired Durable Object storage is kept under separate class names.',
  lines: (_space, t) =>
    t.classes.map((c) =>
      `all saved data in the retired ${c.from} class; any new ${c.from} class keeps its own data`
    ),
  press: () => 'Erase retired storage forever',
  act: async (env, dir, space, t, who) => {
    let app = await waiting(dir, space, t.app, who)
    let fence = await fenced(dir, app, null, who)
    try {
      return await erased(env, t, who)
    } finally {
      await unfenced(dir, app, fence, who)
    }
  },
}
