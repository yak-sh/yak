/** Human-readable wall-clock duration, retaining sub-second precision. */
export let duration = (ms: number): string => {
  ms = Math.max(0, Math.round(ms))
  if (ms < 1000) return `${ms}ms`
  let seconds = Math.floor(ms / 1000)
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m${seconds % 60}s`
}

/** Timing is appended after bounded output, never inside a truncation window. */
export let took = (text: string, ms: number): string =>
  `${text}${text ? '\n' : ''}took ${duration(ms)}` +
  (ms > 60_000 ? ' — over 60s: report this slow command' : '')

type TimingRow = {
  eid: string
  comps: Record<string, Record<string, unknown> | undefined>
}

/** Sum of measured tool waits (parallel calls add, not session age). Older
 * unmeasured results are omitted rather than invented from queue timestamps. */
export let toolTiming = (rows: TimingRow[]): string => {
  let byId = new Map(rows.map((r) => [r.eid, r]))
  let seen = new Set<string>()
  let runs = rows.flatMap((r) => {
    let call = String(r.comps.result?.call ?? '')
    let ms = r.comps.result?.ms
    if (
      !call || seen.has(call) || typeof ms != 'number' ||
      !Number.isFinite(ms) || ms < 0
    ) return []
    seen.add(call)
    let c = byId.get(call)?.comps
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(String(c?.call?.args ?? '{}')) ?? {}
    } catch { /* malformed calls still have a measured result */ }
    let label = String(
      c?.bash?.command ?? args.command ?? c?.tool?.name ?? c?.call?.to ??
        'tool',
    )
    return [{ ms, label: label.replace(/\s+/g, ' ').slice(0, 200) }]
  })
  if (!runs.length) return ''
  return [
    `Tool wall-clock: ${
      duration(runs.reduce((sum, r) => sum + r.ms, 0))
    } (sum of ${runs.length} measured calls; parallel waits add).`,
    'Slowest commands/tools:',
    ...runs.toSorted((a, b) => b.ms - a.ms).slice(0, 3).map((r) =>
      `- ${duration(r.ms)} — ${r.label}`
    ),
  ].join('\n')
}
