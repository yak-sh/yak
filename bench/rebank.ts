/** Convert a suite's reference to CPU by measuring its banked revision beside
 * today's code. The reference's readings are banked; a slower current reading
 * remains visible in the retained comparison instead of becoming the baseline. */
import { type Baseline, baseline } from '@yaks/benchmark'
import { collect, type Judgement, registered } from './paired.ts'

let bankGroup = (evidence: Judgement): Baseline => {
  if (
    !['same', 'slower', 'inconclusive'].includes(evidence.verdict) ||
    evidence.error
  ) {
    throw Error(evidence.error ?? `Comparison was ${evidence.verdict}`)
  }
  if (!evidence.before || !evidence.after || !evidence.reference) {
    throw Error(evidence.error ?? 'No reference measurements to bank')
  }
  for (let run of [evidence.before, evidence.after]) {
    if (!run.metric.endsWith('/cpu')) throw Error('Reference is not CPU timing')
    for (let bench of run.benches) {
      if (bench.samples.some((s) => s.cpu === undefined)) {
        throw Error(`Missing measured CPU: ${bench.name}`)
      }
    }
  }
  // The wall-clock bank's quiet-box condition does not apply to matched CPU.
  let out = baseline(
    [evidence.before, evidence.after].map((r) => ({ ...r, busy: null })),
    0,
  )
  return {
    ...out,
    benches: out.benches.map((b) => ({ ...b, reference: evidence.reference })),
    reference: evidence.reference,
  }
}

export let bank = (evidence: Judgement): Baseline => {
  let groups = (evidence.groups ?? [evidence]).map(bankGroup)
  let byName = new Map(groups.flatMap((g) => g.benches.map((b) => [b.name, b])))
  let names = evidence.current?.benches.map((b) => b.name) ?? [...byName.keys()]
  let { reference: _reference, ...first } = groups[0]
  let references = [...new Set(groups.map((g) => g.reference))]
  return {
    ...first,
    benches: names.map((name) => byName.get(name)!),
    ...(references.length == 1 ? { reference: references[0] } : {}),
  }
}

type Provenance = {
  suite: string
  groups: {
    reference: string
    source: string
    kind: 'recorded' | 'derived'
    benches: string[]
  }[]
}

export let rebank = async (
  suite: string,
  root: string,
  recorded?: Judgement,
) => {
  let path = registered(suite).baseline
  let output = `${root}/bench/${suite}.rebank.results.json`
  let provenance = (JSON.parse(
    await Deno.readTextFile(`${root}/bench/baseline-references.json`),
  ) as Provenance[]).find((p) => p.suite == suite)
  let references = provenance && Object.fromEntries(
    provenance.groups.flatMap((g) =>
      g.benches.map((name) => [name, g.reference])
    ),
  )
  let process = suite.startsWith('operation-') ||
    ['person-commands', 'terminal-interactions', 'hook-waits'].includes(suite)
  let evidence: Judgement
  try {
    evidence = recorded ?? await collect(
      suite,
      root,
      { references, ...(process ? { rounds: 3 } : {}) },
    )
  } catch (error) {
    evidence = {
      verdict: 'failed',
      comparisons: [],
      slower: [],
      error: error instanceof Error ? error.stack ?? error.message : `${error}`,
    }
  }
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n')
  let next = bank(evidence)
  await Deno.writeTextFile(
    `${root}/${path}`,
    JSON.stringify(next, null, 2) + '\n',
  )
  let limited = (evidence.groups ?? [evidence]).some((group) =>
    (group.current?.rounds ?? 0) <
      Math.max(6, Math.ceil(Math.log2(20 * group.comparisons.length)))
  )
  return {
    suite,
    baseline: path,
    reference: evidence.reference,
    references: evidence.references,
    provenance: provenance?.groups,
    revision: evidence.revision,
    rounds: evidence.current?.rounds,
    metric: evidence.current?.metric,
    groups: evidence.groups?.map((group) => ({
      reference: group.reference,
      revision: group.revision,
      rounds: group.current?.rounds,
      verdict: group.verdict,
      benches: group.current?.benches.map((b) => b.name),
    })),
    verdict: evidence.verdict,
    status: evidence.verdict == 'inconclusive'
      ? 'inconclusive; default monitor confirmation pending'
      : limited && evidence.verdict == 'slower'
      ? 'slower candidate awaiting default monitor confirmation'
      : limited && evidence.verdict == 'same'
      ? 'same in limited rounds'
      : evidence.verdict,
    confidence: limited ? 'limited rounds' : 'default monitor round count',
    reason: evidence.verdict == 'inconclusive'
      ? 'Reference CPU ranges did not overlap in the measured rounds'
      : undefined,
    slower: evidence.slower,
    error: evidence.error,
    comparisons: evidence.comparisons,
    evidence: `bench/${suite}.rebank.results.json`,
  }
}

if (import.meta.main) {
  using lock = await Deno.open('/tmp/yaks-throughput-bench.lock', {
    create: true,
    read: true,
    write: true,
  })
  await lock.lock(true)
  let root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
  let report = `${root}/bench/cpu-baselines.json`
  let results: Record<string, unknown>[] = []
  try {
    results = JSON.parse(await Deno.readTextFile(report))
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  let failed = false
  for (let suite of Deno.args) {
    console.error(`rebank: ${suite}`)
    results = results.filter((r) => r.suite != suite)
    try {
      let result = await rebank(suite, root)
      results.push(result)
      console.error(`${suite}: banked reference CPU; current ${result.status}`)
    } catch (error) {
      failed = true
      let message = error instanceof Error ? error.message : `${error}`
      let evidence = JSON.parse(
        await Deno.readTextFile(`${root}/bench/${suite}.rebank.results.json`),
      ) as Judgement
      results.push({
        suite,
        reference: evidence.reference,
        revision: evidence.revision,
        verdict: evidence.verdict,
        error: message,
      })
      console.error(`${suite}: ${message}`)
    }
    await Deno.writeTextFile(
      report,
      JSON.stringify(results, null, 2) + '\n',
    )
  }
  if (failed) Deno.exitCode = 1
}
