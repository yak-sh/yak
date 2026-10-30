/** A durable fair measurement queue: work survives a cron window or a busy box
 * without restarting from the first suite. */
import type { Outcome } from './monitor.ts'
export type Job = { suite: string; due: number }
export type Queue = { jobs: Job[]; screened: Record<string, number> }
/** Owe each suite not checked in the last hour, once, oldest first. A suite no
 * longer on the list is owed nothing, whatever an earlier tick left queued. */
export let enqueue = (q: Queue, suites: string[], now: number) => {
  q.jobs = q.jobs.filter((j) => suites.includes(j.suite))
  for (let suite of suites) {
    if (
      !q.jobs.some((j) => j.suite == suite) &&
      now - (q.screened[suite] ?? -Infinity) >= 3_600_000
    ) {
      q.jobs.push({ suite, due: now })
    }
  }
  q.jobs.sort((a, b) => a.due - b.due)
}
/** A check has its original active timeout. Lock contention or a loaded box
 * consumes no job: the tick stops, and the job waits at the head of the queue;
 * an interrupted job remains at the head because persistence precedes work. */
export let drain = async (q: Queue, io: {
  now: () => number
  deadline: number
  save: () => Promise<void>
  check: (job: Job) => Promise<Outcome['verdict']>
}) => {
  await io.save()
  while (q.jobs.length && io.now() < io.deadline) {
    let job = q.jobs[0]
    let verdict = await io.check(job)
    if (verdict == 'deferred' || verdict == 'loaded') return
    q.jobs.shift()
    q.screened[job.suite] = io.now()
    await io.save()
  }
}
