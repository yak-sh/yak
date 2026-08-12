// Shared replay evidence rules. Database window selection and provider
// projection must agree on which checkpoint can replace an immutable prefix.
export type EntryRow = {
  eid: string
  seq: number
  comps: Record<string, Record<string, unknown>>
}

let object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

export let providerOf = (row: EntryRow | undefined) =>
  String(row?.comps.generation?.provider ?? '')

export let opaqueItem = (row: EntryRow) => {
  let format = row.comps.opaque?.format
  let raw = row.comps.opaque?.data
  if (typeof format != 'string' || typeof raw != 'string') return undefined
  try {
    let value = JSON.parse(raw)
    return object(value) && typeof value.type == 'string' &&
        format == `openai:${value.type}`
      ? value
      : undefined
  } catch {
    return undefined
  }
}

// A provider may replace history only with opaque evidence it can replay. A
// provider switch, malformed payload, or failed compaction therefore leaves
// the immutable prefix in the window.
export let checkpointValid = (
  row: EntryRow,
  byEid: Map<string, EntryRow>,
  provider: string,
) => {
  if (!row.comps.output || !row.comps.checkpoint) return false
  let source = byEid.get(String(row.comps.output.source))
  return providerOf(source) == provider && !!opaqueItem(row)
}
