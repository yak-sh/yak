// Generation checks every file at this seam; tests need only one file of each
// kind, independent of how many pages the guide has grown to hold.
export function contentIdentity(
  meta: Record<string, unknown>,
  kind: 'guide' | 'prompt',
  name: string,
  file: string,
): void {
  let prop = kind == 'guide' ? 'slug' : 'name'
  let row = meta[kind] as Record<string, unknown> | undefined
  if (!row) throw new Error(`${file} says no ${kind}`)
  if (meta.entity !== undefined) {
    throw new Error(
      `${file} names an entity — its ${kind}.${prop} is what does that`,
    )
  }
  if (row[prop] !== name) {
    throw new Error(`${file}: ${kind}.${prop} is ${row[prop]}, not ${name}`)
  }
}
