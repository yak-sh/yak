import { refuse } from './tool.ts'
import { sha256 } from '@yaks/graph/sha256'

export type Retirement = { from: string; to: string }

export let retiredName = (tag: string, name: string) =>
  'YakRetired_' + sha256(JSON.stringify([tag, name]))

export let retirements = (migrations: Record<string, unknown>[] = []) =>
  migrations.flatMap(({ tag, deleted_classes }) =>
    Array.isArray(deleted_classes)
      ? deleted_classes.map((from: string) => ({
        from,
        to: retiredName(String(tag), from),
      }))
      : []
  )

// A confirmation advances Cloudflare's tag without changing the person's
// migration history. The next deploy continues after that history's tag.
export let confirmedTag = (tag: string, id: string) =>
  `yak-confirm:${encodeURIComponent(logicalTag(tag))}:${id}`

export let logicalTag = (tag: string) => {
  let held = /^yak-confirm:([^:]*):[0-9a-f-]{36}$/.exec(tag)
  return held ? decodeURIComponent(held[1]) : tag
}

export let retirementExports = (names: string[]) =>
  names.map((name) =>
    `export class ${name} { fetch() { return new Response('This storage is retained until its owner confirms deletion.', { status: 410 }) } }`
  ).join('\n')

export let archived = (script: {
  named_handlers?: { name: string }[]
}) =>
  (script.named_handlers ?? []).map((h) => h.name).filter((name) =>
    /^YakRetired_[0-9a-f]{64}$/.test(name)
  )

export type MigrationMetadata = {
  old_tag?: string
  new_tag: string
  steps: Record<string, unknown>[]
}

// Wrangler keeps the history in config, but the upload takes only steps after
// the remote tag. Replaying earlier steps could delete or recreate app data.
// https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/deploy/helpers/durable.ts
export let migrationMetadata = (
  migrations: Record<string, unknown>[] | undefined,
  current?: string,
): MigrationMetadata | undefined => {
  if (!migrations?.length) return
  let seen = new Set<string>()
  let tags = migrations.map((migration, i) => {
    let tag = migration.tag
    if (typeof tag != 'string' || !tag.trim()) {
      throw refuse(
        'arguments',
        `refused migrations[${i}].tag: expected a nonempty migration tag`,
      )
    }
    if (seen.has(tag)) {
      throw refuse(
        'arguments',
        `refused migrations[${i}].tag: ${JSON.stringify(tag)} is repeated; ` +
          'each migration needs its own tag',
      )
    }
    seen.add(tag)
    return tag
  })
  let applied = current
    ? tags.indexOf(tags.includes(current) ? current : logicalTag(current))
    : -1
  if (current && applied < 0) {
    throw refuse(
      'arguments',
      `refused migrations: deployed tag ${JSON.stringify(current)} is ` +
        'missing from config; keep previously applied tags and append new migrations',
    )
  }
  let pending = migrations.slice(applied + 1)
  if (!pending.length) return
  return {
    ...(current ? { old_tag: current } : {}),
    new_tag: tags[tags.length - 1],
    steps: pending.map(({ tag, deleted_classes: _deleted, ...step }) => {
      let renamed = retirements([{ tag, deleted_classes: _deleted }])
      return renamed.length
        ? {
          ...step,
          renamed_classes: [
            ...(step.renamed_classes as Retirement[] ?? []),
            ...renamed,
          ],
        }
        : step
    }),
  }
}
