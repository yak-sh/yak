/** Import Deno bench JSON without retiming it. Deno exposes invocation averages,
 * not its raw operation timings; retain both the average and supplied statistics. */
import { sameNames, type Sample } from './result.ts'

export type DenoReport = {
  version: number
  runtime: string
  cpu: string
  benches: {
    name: string
    results: {
      ok?: { avg: number; [key: string]: unknown }
      failed?: unknown
    }[]
  }[]
}
export let extract = (
  report: DenoReport,
  expected: readonly string[],
): Record<string, Sample> => {
  if (report.version !== 1 || !report.runtime || !report.cpu) {
    throw new Error('Unsupported Deno bench report')
  }
  sameNames(
    expected.map((name) => ({ name, unit: 'ns/op' })),
    report.benches.map((b) => ({ name: b.name, unit: 'ns/op' })),
  )
  return Object.fromEntries(report.benches.map((b) => {
    let ok = b.results[0]?.ok
    if (
      b.results.length != 1 || !ok || b.results[0].failed ||
      !Number.isFinite(ok.avg) || ok.avg <= 0
    ) {
      throw new Error(`Failed or invalid Deno result: ${b.name}`)
    }
    return [b.name, {
      value: ok.avg,
      source: 'deno-average',
      details: { ...ok },
    }]
  }))
}
