/** Convert a suite's reference to CPU by measuring its banked revision beside
 * today's code. The reference's readings are banked; a slower current reading
 * remains visible in the retained comparison instead of becoming the baseline. */
import { baseline, type Run } from '@yaks/benchmark'
import { collect, type Judgement, registered } from './paired.ts'

export let bank = (evidence: Judgement) => {
  if (!['same', 'slower'].includes(evidence.verdict)) {
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
  return {
    // The paired measurements carry their measured pressure in the evidence.
    // CPU banking takes the spread of these matched reference observations;
    // the wall-clock bank's quiet-box requirement does not apply to them.
    ...baseline(
      [evidence.before, evidence.after].map((r) => ({ ...r, busy: null })),
      0,
    ),
    reference: evidence.reference,
  }
}

export let rebank = async (suite: string, root: string) => {
  let path = registered(suite).baseline
  let output = `${root}/bench/${suite}.rebank.results.json`
  let evidence: Judgement
  try {
    evidence = await collect(
      suite,
      root,
      suite == 'operation-lifecycle' ? { rounds: 3 } : {},
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
  let summary = (run: Run | undefined) =>
    run?.benches.map((b) => ({
      name: b.name,
      median: b.median,
      rounds: b.rounds.map((r) => r.cpu),
    }))
  return {
    suite,
    baseline: path,
    reference: evidence.reference,
    revision: evidence.revision,
    rounds: evidence.current?.rounds,
    verdict: evidence.verdict,
    slower: evidence.slower,
    error: evidence.error,
    comparisons: evidence.comparisons,
    before: summary(evidence.before),
    current: summary(evidence.current),
    after: summary(evidence.after),
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
      console.error(`${suite}: banked reference CPU; current ${result.verdict}`)
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
