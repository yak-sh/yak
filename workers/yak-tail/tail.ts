import { INCIDENTS, REPLY_TO } from '../yak/mail-config.ts'
import type { Binding } from '../yak/post.ts'
import {
  COOLDOWN,
  type Event,
  type Fault,
  faults,
  type Incident,
  record,
} from './incidents.ts'

type Metadata = { paged: boolean }
export type Env = {
  SEEN: {
    getWithMetadata<T, M>(
      key: string,
      type: 'json',
    ): Promise<{ value: T | null; metadata: M | null }>
    put(
      key: string,
      value: string,
      options: { metadata: Metadata },
    ): Promise<void>
  }
  MAIL: Binding
  YAK_OWNER_EMAIL?: string
}

/** The fault's own words, one line of them: a subject stays a subject. */
let brief = (message: string, max = 80) => {
  let line = message.split('\n')[0].trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export let letter = (incident: Incident, to = REPLY_TO) => ({
  from: INCIDENTS,
  to,
  // What broke, where, in the subject line: an inbox is read at a glance, and
  // the signature is the letter's own first line.
  subject:
    `[yaks.app] ${incident.sample.entrypoint}: ${incident.sample.name}: ${
      brief(incident.sample.message)
    }`,
  text: [
    `Signature: ${incident.signature}`,
    `Version: ${incident.version ?? 'unavailable'}`,
    `Entrypoint: ${incident.sample.entrypoint}`,
    `First: ${new Date(incident.first).toISOString()}`,
    `URL: ${incident.sample.url ?? '(no request URL)'}`,
    '',
    `${incident.sample.name}: ${incident.sample.message}`,
    incident.sample.stack,
  ].join('\n'),
})

type Held = { incident: Incident | null; paged: boolean; written: number }
type Pending = { events: Fault[]; done: Promise<void> }

/**
 * Coalesce a boot loop before writing: KV permits one write/key/second.
 * The queue and warm cache serialize one isolate; KV cannot serialize separate
 * isolates/locations, so this is best-effort deduplication, not a global lock.
 */
export let recorder = (
  now = Date.now,
  sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
) => {
  let held = new Map<string, Held>()
  let pending = new Map<string, Pending>()

  let drain = async (key: string, job: Pending, env: Env) => {
    let errors: unknown[] = []
    let state = held.get(key)
    if (!state) {
      let saved = await env.SEEN.getWithMetadata<Incident, Metadata>(
        key,
        'json',
      )
      state = {
        incident: saved.value,
        // Start held: only record() opens the door. Starting a first sighting
        // unpaged mailed every patient fault's first hit, which is the one
        // occurrence PATIENCE exists to swallow.
        paged: saved.metadata?.paged ?? true,
        written: 0,
      }
      held.set(key, state)
    }
    while (job.events.length) {
      let delay = state.written + 1000 - now()
      if (delay > 0) await sleep(delay)
      let events = job.events.splice(0).sort((a, b) => a.at - b.at)
      let split = events.findIndex((e, i) =>
        i > 0 && e.at - events[i - 1].at >= COOLDOWN
      )
      if (split > 0) job.events.push(...events.splice(split))
      for (let event of events) {
        let next = record(state.incident, event)
        state.incident = next.incident
        if (next.page) state.paged = false
      }
      let incident = state.incident!
      if (!state.paged) {
        try {
          await env.MAIL.send(letter(incident, env.YAK_OWNER_EMAIL || REPLY_TO))
          state.paged = true
        } catch (e) {
          errors.push(e)
        }
      }
      // Even if mail fails, the graph reader gets the incident. The metadata
      // leaves the next event free to retry delivery; it does not burn a page.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await env.SEEN.put(key, JSON.stringify(incident), {
            metadata: { paged: state.paged },
          })
          break
        } catch (e) {
          // Another isolate can have written since our read. KV's documented
          // per-key limit answers 429; wait before retrying that write.
          if (/429/.test(String(e)) && attempt < 2) await sleep(1000)
          else {
            errors.push(e)
            break
          }
        } finally {
          state.written = now()
        }
      }
    }
    // Drain events which arrived during a failed send/write before releasing
    // their shared promise. Otherwise a mail failure drops queued counts.
    if (errors.length) {
      throw new AggregateError(errors, 'incident write or mail failed')
    }
  }

  return async (events: Event[], env: Env): Promise<void> => {
    for (let [key, state] of held) {
      if (
        !pending.has(key) &&
        (now() - state.written > COOLDOWN || held.size > 1024)
      ) {
        held.delete(key)
      }
    }
    let groups = new Map<string, Fault[]>()
    for (let event of events) {
      for (let fault of await faults(event, now())) {
        let key = `incident/${fault.signature}`
        let group = groups.get(key) ?? []
        group.push(fault)
        groups.set(key, group)
      }
    }
    let writes: Promise<void>[] = []
    for (let [key, group] of groups) {
      let job = pending.get(key)
      if (job) job.events.push(...group)
      else {
        job = { events: group, done: Promise.resolve() }
        pending.set(key, job)
        job.done = drain(key, job, env).finally(() => pending.delete(key))
      }
      writes.push(job.done)
    }
    // A broken mail or KV operation for one signature must not cancel others.
    let results = await Promise.allSettled(writes)
    let errors = results.filter((r) => r.status == 'rejected')
    if (errors.length) {
      throw new AggregateError(
        errors.map((r) => r.reason),
        'yaks.app incident delivery failed',
      )
    }
  }
}

let receive = recorder()
export default {
  tail(
    events: Event[],
    env: Env,
    ctx: { waitUntil(work: Promise<unknown>): void },
  ) {
    ctx.waitUntil(receive(events, env))
  },
}
