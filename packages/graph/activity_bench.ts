/** Count-bounded idle-path comparison. BASE_GRAPH names an exported baseline
 * graph.ts from this checkout before runtime instrumentation (not a live host).
 * Run from the workspace: deno run -A packages/graph/activity_bench.ts.
 * No subscriber, clock or ID is installed in the measured graph itself.
 */
import { graph } from './graph.ts'
import { channel } from '@yaks/trace'
import { parse } from '@yaks/query'
import { books, memory } from './testing.ts'
import type { Graph } from './graph.ts'
import type { Samples } from '@yaks/benchmark'
import { standaloneMain } from '../../bench/standalone.ts'

export async function measure(
  _args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(Deno.env.get('BENCH_N') ?? 3000)
  let rounds = Number(Deno.env.get('BENCH_ROUNDS') ?? 7)
  if (
    !Number.isInteger(n) || n < 100 || n > 50000 ||
    !Number.isInteger(rounds) || rounds < 3 || rounds > 15
  ) {
    throw new Error('BENCH_N 100..50000 and BENCH_ROUNDS 3..15 required')
  }
  let base = Deno.env.get('BASE_GRAPH')
  let absent = base
    ? (await import(new URL(base, import.meta.url).href)).graph
    : graph
  let modes: [string, () => Graph][] = [
    ['absent', () => absent({ vocab: books, storage: memory() })],
    ['uncreated', () => graph({ vocab: books, storage: memory() })],
    ['inactive', () => {
      let g = graph({ vocab: books, storage: memory() })
      channel(g)
      return g
    }],
  ]
  let results: Record<string, { apply: number[]; query: number[] }> = {}
  let query = parse('.book.pages=1')
  let sample = (g: Graph, operation: 'apply' | 'query') => {
    let began = performance.now()
    for (let i = 0; i < n; i++) {
      if (operation == 'apply') {
        g.apply([
          { entity: { eid: 'bench-book' }, book: { pages: i % 2 + 1 } },
        ])
      } else g.read(query)
    }
    return performance.now() - began
  }
  for (let [name, make] of modes) {
    results[name] = { apply: [], query: [] }
    let g = make()
    for (let i = 0; i < 300; i++) {
      g.apply([
        { entity: { eid: 'bench-book' }, book: { pages: 1 } },
      ])
    }
    for (let i = 0; i < 300; i++) g.read(query)
  }
  for (let round = 0; round < rounds; round++) {
    let ordered = [
      ...modes.slice(round % modes.length),
      ...modes.slice(0, round % modes.length),
    ]
    for (let [name, make] of ordered) {
      let g = make()
      for (let i = 0; i < 500; i++) {
        g.apply([
          { entity: { eid: 'bench-book' }, book: { pages: i % 2 + 1 } },
        ])
      }
      for (let i = 0; i < 500; i++) g.read(query)
      for (let op of ['apply', 'query'] as const) {
        results[name][op].push(sample(g, op))
      }
    }
  }
  return Object.fromEntries(
    Object.entries(results).flatMap(([mode, ops]) =>
      Object.entries(ops).map((
        [op, values],
      ) => [
        mode + '/' + op,
        values.map((value) => ({
          value: value * 1e6 / n,
          source: 'batch',
          counts: { operations: n },
          details: { baseline: base ?? 'same-build' },
        })),
      ])
    ),
  )
}

if (import.meta.main) await standaloneMain('graph-activity')
