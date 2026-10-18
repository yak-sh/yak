/** Contemporaneous code comparisons for isolated fixtures. Raw wall time and its
 * absolute ratchet remain untouched: this evidence distinguishes code changes
 * from a busy host, and can never bank a new best or declare a budget passed. */
import { host, median, type Run, type Samples } from '@yaks/benchmark'

export type Pair = { before: Run; current: Run; after: Run }
export type Evidence = {
  verdict: 'changed' | 'unconfirmed' | 'inconclusive'
  slower: string[]
  comparisons: {
    name: string
    before: number[]
    current: number[]
    after: number[]
  }[]
}
export let compare = ({ before, current, after }: Pair): Evidence => {
  for (let run of [before, after]) {
    for (
      let field of ['suite', 'metric', 'workload', 'runtime', 'cpu'] as const
    ) {
      if (run[field] != current[field]) throw Error(`Paired ${field} differs`)
    }
    if (
      JSON.stringify(run.benches.map((b) => [b.name, b.unit, b.better])) !=
        JSON.stringify(current.benches.map((b) => [b.name, b.unit, b.better]))
    ) {
      throw Error('Paired workloads differ')
    }
  }
  let comparisons = current.benches.map((b, i) => ({
    name: b.name,
    before: before.benches[i].rounds.map((r) => r.median),
    current: b.rounds.map((r) => r.median),
    after: after.benches[i].rounds.map((r) => r.median),
  }))
  let overlap = (a: number[], b: number[]) =>
    Math.max(...a) >= Math.min(...b) && Math.max(...b) >= Math.min(...a)
  let valid = (xs: number[]) =>
    xs.length >= 3 && xs.every((x) => Number.isFinite(x) && x > 0)
  let unstable = comparisons.some((b) =>
    ![b.before, b.current, b.after].every(valid) ||
    !overlap(b.before, b.after) || median(b.before) < Math.min(...b.after) ||
    median(b.before) > Math.max(...b.after) ||
    median(b.after) < Math.min(...b.before) ||
    median(b.after) > Math.max(...b.before)
  )
  let slower = comparisons.filter((b, i) => {
    let reference = [...b.before, ...b.after]
    return current.benches[i].better == 'lower'
      ? Math.min(...b.current) > Math.max(...reference)
      : Math.max(...b.current) < Math.min(...reference)
  }).map((b) => b.name)
  return {
    verdict: unstable
      ? 'inconclusive'
      : slower.length
      ? 'changed'
      : 'unconfirmed',
    slower,
    comparisons,
  }
}

/** The bracket keeps code selection and cleanup independent of the host clock. */
export let bracket = async <T>(
  measure: (revision: 'reference' | 'current') => Promise<T>,
  close: () => Promise<void>,
) => {
  try {
    let before = await measure('reference')
    let current = await measure('current')
    let after = await measure('reference')
    return { before, current, after }
  } finally {
    await close()
  }
}

let command = async (cwd: string, cmd: string, args: string[]) => {
  let out = await new Deno.Command(cmd, {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw Error(`${cmd}: ${new TextDecoder().decode(out.stderr).slice(-16000)}`)
  }
  return out.stdout
}

/** Both product revisions run the identical present-day driver and fixture.
 * The caller holds the shared benchmark lock for the complete bracket. No live
 * database is opened or copied; each probe owns and cleans its seeded graph. */
export let collect = async (
  suite: string,
  root: string,
): Promise<
  Pair & Evidence & { reference: string; revision: string; driverHash: string }
> => {
  if (!['platform-waits', 'inbox-content'].includes(suite)) {
    throw Error('No isolated paired fixture')
  }
  let text = new TextDecoder()
  let reference = text.decode(
    await command(root, 'git', [
      'log',
      '-1',
      '--format=%H',
      '--',
      `bench/${suite}.baseline.json`,
    ]),
  ).trim()
  let current = text.decode(await command(root, 'git', ['rev-parse', 'HEAD']))
    .trim()
  if (!reference) throw Error('No banked product revision')
  let context = await host()
  let driver = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      (await Promise.all(
        (await Array.fromAsync(Deno.readDir(`${root}/bench`))).filter((e) =>
          e.isFile && e.name.endsWith('.ts')
        ).sort((a, b) => a.name.localeCompare(b.name)).map((e) =>
          Deno.readTextFile(`${root}/bench/${e.name}`)
        ),
      )).join('\n'),
    ),
  )
  let driverHash = [...new Uint8Array(driver)].map((b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  let scratch = await Deno.makeTempDir({ prefix: 'bench-paired-' })
  try {
    let roots: string[] = []
    for (let [i, revision] of [reference, current].entries()) {
      let target = `${scratch}/${i}`
      await Deno.mkdir(target)
      let archive = await command(root, 'git', ['archive', revision])
      let tar = `${scratch}/${i}.tar`
      await Deno.writeFile(tar, archive)
      await command(root, 'tar', ['-xf', tar, '-C', target])
      await Deno.remove(tar)
      for await (let entry of Deno.readDir(`${root}/bench`)) {
        if (entry.isFile && entry.name.endsWith('.ts')) {
          await Deno.copyFile(
            `${root}/bench/${entry.name}`,
            `${target}/bench/${entry.name}`,
          )
        }
      }
      // Reuse dependencies, not generated product assets or a graph.
      try {
        await Deno.symlink(`${root}/node_modules`, `${target}/node_modules`)
      } catch (e) {
        if (!(e instanceof Deno.errors.AlreadyExists)) throw e
      }
      // Generators enumerate tracked sources. A private index makes this
      // archive self-contained without a managed worktree or a live checkout.
      await command(target, 'git', ['init', '-q'])
      await command(target, 'git', ['add', '-A'])
      roots.push(target)
    }
    let observations: Record<string, Samples>[][] = [[], [], []]
    let measure = async (at: number, slot: number) => {
      let dir = roots[at]
      let probe = `${suite}-probe.ts`
      let rounds: Record<string, Samples>[] = []
      for (let i = 0; i < 1; i++) {
        let output = text.decode(
          await command(dir, Deno.execPath(), [
            'run',
            '-A',
            '--config',
            `${dir}/deno.json`,
            `${dir}/bench/${probe}`,
          ]),
        )
        let prefix = suite == 'platform-waits'
          ? 'PLATFORM_WAITS_RESULT='
          : 'INBOX_CONTENT_RESULT='
        let line = output.split('\n').findLast((line) =>
          line.startsWith(prefix)
        )
        if (!line) throw Error('Paired collector returned no measurements')
        rounds.push(JSON.parse(line.slice(prefix.length)))
      }
      observations[slot].push(...rounds)
    }
    for (let round = 0; round < 3; round++) {
      await bracket(
        (revision) =>
          measure(
            revision == 'reference' ? 0 : 1,
            revision == 'current'
              ? 1
              : observations[0].length == observations[2].length
              ? 0
              : 2,
          ),
        async () => {},
      )
    }
    let aggregate = async (slot: number): Promise<Run> => {
      let { run } = await import('@yaks/benchmark')
      let baseline = JSON.parse(
        await Deno.readTextFile(`${root}/bench/${suite}.baseline.json`),
      )
      return await run({
        name: suite,
        metric: baseline.metric,
        workload: baseline.workload,
        benches: baseline.benches,
        collect: (round: number) => observations[slot][round],
      }, {
        rounds: 3,
        output: `${scratch}/run.json`,
        reporters: () => [],
        host: () => ({
          config: {},
          configURL: null,
          commit: slot == 1 ? current : reference,
          runtime: `Deno/${Deno.version.deno} ${Deno.build.target}`,
          cpu: context.cpu,
          load: context.load,
        }),
      })
    }
    let pair = {
      before: await aggregate(0),
      current: await aggregate(1),
      after: await aggregate(2),
    }
    return {
      ...pair,
      ...compare(pair),
      reference,
      revision: current,
      driverHash,
    }
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}

if (import.meta.main) {
  let [suite, output] = Deno.args
  if (!output) {
    throw Error('usage: paired.ts SUITE OUTPUT (caller holds benchmark lock)')
  }
  let evidence = await collect(suite, new URL('../', import.meta.url).pathname)
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(
    `${suite}: paired ${evidence.verdict}; no absolute budget was passed or banked`,
  )
}
