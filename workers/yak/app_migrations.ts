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
      throw new Error(
        `refused migrations[${i}].tag: expected a nonempty migration tag`,
      )
    }
    if (seen.has(tag)) {
      throw new Error(
        `refused migrations[${i}].tag: ${JSON.stringify(tag)} is repeated; ` +
          'each migration needs its own tag',
      )
    }
    seen.add(tag)
    return tag
  })
  let applied = current ? tags.indexOf(current) : -1
  if (current && applied < 0) {
    throw new Error(
      `refused migrations: deployed tag ${JSON.stringify(current)} is ` +
        'missing from config; keep previously applied tags and append new migrations',
    )
  }
  let pending = migrations.slice(applied + 1)
  if (!pending.length) return
  return {
    ...(current ? { old_tag: current } : {}),
    new_tag: tags[tags.length - 1],
    steps: pending.map(({ tag: _tag, ...step }) => step),
  }
}
