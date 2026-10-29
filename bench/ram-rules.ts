// Warm apply cost as unrelated declared rules grow. Run with:
// deno run -A bench/ram-rules.ts
import { stopwatch } from '@yaks/benchmark'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type PropSchema } from '@yaks/vocab'

for (let n of [10, 100, 1000]) {
  let suffix = (n: number): string =>
    String.fromCharCode(97 + n % 26) +
    (n >= 26 ? suffix(Math.floor(n / 26) - 1) : '')
  let $defs: Record<string, PropSchema> = {}
  for (let i = 0; i < n; i++) {
    $defs[`input${suffix(i)}`] = { component: true, properties: {} }
    $defs[`output${suffix(i)}`] = { component: true, properties: {} }
    $defs[`rule${suffix(i)}`] = {
      rule: true,
      match: `.input${suffix(i)}, +!output${suffix(i)}`,
    }
  }
  let vocab = loadVocab({ $defs })
  let g = graph({ vocab, storage: ram(vocab), provenance: false })
  let batch = [{ entity: { eid: 'frame' }, inputa: {}, outputa: null }]
  for (let i = 0; i < 100; i++) g.apply(batch)
  let samples: { value: number; cpu: number }[] = []
  for (let r = 0; r < 7; r++) {
    let took = stopwatch()
    for (let i = 0; i < 500; i++) g.apply(batch)
    let { value, cpu } = took()
    samples.push({ value: value / 500, cpu: cpu / 500 })
  }
  samples.sort((a, b) => a.cpu - b.cpu)
  console.log(
    `${n} rules: ${samples[3].cpu.toFixed(3)} CPU ms/apply (median of 7 × 500)`,
  )
}
