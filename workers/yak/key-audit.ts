// The sweep's evidence is graph bundles, never storage tables. Walk the graph's
// cursor until exhaustion (including a short page); a store may cap each read.
import { type Bundle, type Comp } from '@yaks/graph'
import { buildOf, outputOf } from '@yaks/builders'
import { keyEid } from '@yaks/key'
import { type Door } from './door.ts'
import { KERNEL } from './meta.ts'

export let part = (row: Bundle | undefined, name: string): Comp | undefined => {
  let value = row?.[name]
  return value && typeof value == 'object' && !Array.isArray(value)
    ? value
    : undefined
}

export let pages = async (
  door: Pick<Door, 'consume'>,
  q = '.entity&*',
): Promise<Bundle[]> => {
  let rows: Bundle[] = []
  let after = ''
  let seen = new Set<string>()
  for (;;) {
    let line = `${q}&.limit=200${after ? `&.after=${after}` : ''}`
    let page: Bundle[] = await door.consume(
      `/query?q=${encodeURIComponent(line)}`,
      (response) => response.json(),
      { method: 'GET' },
      KERNEL,
    )
    if (!page.length) return rows
    for (let row of page) {
      if (seen.has(row.entity.eid)) {
        throw new Error('audit cursor repeated an eid')
      }
      seen.add(row.entity.eid)
      rows.push(row)
    }
    after = page[page.length - 1].entity.eid
  }
}

/** Only audit-bearing rows, not git blobs or the platform's unrelated rows. */
export let auditRows = async (door: Pick<Door, 'consume'>) => {
  let rows = new Map<string, Bundle>()
  for (let name of ['build', 'built', 'build_of', 'output_of']) {
    for (let row of await pages(door, `.${name}&*`)) {
      rows.set(row.entity.eid, row)
    }
  }
  return [...rows.values()]
}

let string = (value: unknown): value is string =>
  typeof value == 'string' && !!value.trim()

export let keys = (rows: Bundle[]) => {
  let counts = { build: 0, built: 0, build_of: 0, output_of: 0 }
  let by = new Map(rows.map((row) => [row.entity.eid, row]))
  let expected = new Map<string, { eid: string; kind: string; value: string }>()
  let issues: { code: string; row: Bundle; expected?: unknown }[] = []
  let want = (row: Bundle, kind: string, value: string) => {
    let eid = keyEid(kind, value)
    let owner = { eid: row.entity.eid, kind, value }
    let previous = expected.get(eid)
    if (previous && previous.eid != owner.eid) {
      issues.push({ code: 'duplicate_value', row, expected: previous })
    }
    expected.set(eid, owner)
    let held = by.get(eid)
    if (!held) {
      issues.push({
        code: 'missing_key',
        row,
        expected: { ...owner, key: eid },
      })
    } else if (
      !part(held, kind) || part(held, 'key')?.of != owner.eid ||
      part(held, 'key')?.value != value
    ) {
      issues.push({ code: 'wrong_key', row: held, expected: owner })
    }
  }
  for (let row of rows) {
    if (part(row, 'build')) counts.build++
    if (part(row, 'built')) counts.built++
    if (part(row, 'build_of')) counts.build_of++
    if (part(row, 'output_of')) counts.output_of++
    let build = part(row, 'build')
    if (build) {
      let match = build.match
      let tuple: unknown
      if (string(match)) {
        try {
          tuple = JSON.parse(match)
        } catch { /* diagnosed below */ }
      }
      if (
        !string(build.builder) || !string(match) ||
        !Array.isArray(tuple) || !tuple.every((id) => id === null || string(id))
      ) {
        issues.push({ code: 'malformed_build', row })
      } else {want(
          row,
          'build_of',
          buildOf(build.builder, match, String(build.variant || 'main')),
        )}
    }
    let built = part(row, 'built')
    if (built) {
      if (!string(built.build) || !string(built.slot)) {
        issues.push({ code: 'malformed_built', row })
      } else {
        if (!part(by.get(built.build), 'build')) {
          issues.push({ code: 'missing_build', row })
        }
        want(row, 'output_of', outputOf(built.build, built.slot))
      }
    }
  }
  for (let row of rows) {
    for (let kind of ['build_of', 'output_of']) {
      if (!part(row, kind)) continue
      let key = part(row, 'key')
      if (!string(key?.of) || !string(key?.value)) {
        issues.push({ code: 'malformed_key', row })
        continue
      }
      if (keyEid(kind, key.value) != row.entity.eid) {
        issues.push({ code: 'wrong_key_eid', row })
      }
      let target = by.get(key.of)
      if (!part(target, kind == 'build_of' ? 'build' : 'built')) {
        issues.push({ code: 'orphan_key', row })
      }
      let wanted = expected.get(row.entity.eid)
      if (
        !wanted || wanted.kind != kind || wanted.eid != key.of ||
        wanted.value != key.value
      ) issues.push({ code: 'unexpected_key', row })
    }
  }
  return { counts, issues, entities: rows.length, snapshot: false }
}
