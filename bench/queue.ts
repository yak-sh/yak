/** A durable fair measurement queue. Screens precede confirmations, and work
 * survives a cron window or a busy box without restarting from the first suite. */
import type { Outcome } from './monitor.ts'
export type Job = { suite: string; phase: 'screen' | 'confirm'; due: number }
export type Queue = { jobs: Job[]; screened: Record<string, number> }
export let enqueue = (q: Queue, suites: string[], now: number) => {
  for (let suite of suites) {
    if (
      !q.jobs.some((j) => j.suite == suite) &&
      now - (q.screened[suite] ?? -Infinity) >= 3_600_000
    ) {
      q.jobs.push({ suite, phase: 'screen', due: now })
    }
  }
  let priority = (j: Job) => j.phase == 'confirm' && now - j.due >= 3_600_000 ? -1 : j.phase == 'screen' ? 0 : 1
  q.jobs.sort((a,b) => priority(a) - priority(b) || a.due - b.due)
}
/** A check has its original active timeout. Lock contention consumes no job;
 * an interrupted job remains at the head because persistence precedes work. */
export let drain = async (q: Queue, io: {
  now: () => number
  deadline: number
  save: () => Promise<void>
  check: (job: Job) => Promise<Outcome>
  settle: (job: Job, outcome: Outcome) => Promise<void>
}) => {
  await io.save()
  while (q.jobs.length && io.now() < io.deadline) {
    let job = q.jobs[0]
    let outcome: Outcome
    try {
      outcome = await io.check(job)
    } catch (error) {
      outcome = {
        verdict: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (outcome.verdict == 'deferred') return
    if (!(job.phase == 'screen' && outcome.verdict == 'regressed')) await io.settle(job, outcome)
    q.jobs.shift()
    if (job.phase == 'screen') {
      q.screened[job.suite] = io.now()
      if (outcome.verdict == 'regressed') {
        q.jobs.push({ ...job, phase: 'confirm' })
      }
    }
    await io.save()
  }
}
