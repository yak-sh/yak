#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net
// Time the compile door, NOT app_deploy (bin/app-deploy-time.ts). POST one
// captured Job repeatedly to a private probe bound to the deploy's compiler.
// First request is recorded separately: a new container may have to start.
// Never infer compiler work or cold-start time from end-to-end time alone.
//
// COMPILER_URL=... COMPILER_TOKEN=... deno run -A bin/app-compile-time.ts \
//   job.json compiler-sha source-sha [runs=5] [record=compile-results.jsonl]
//
// A probe must forward x-yak-compiler-job:1 and the complete response, and
// authenticate its caller. Its URL/token are not recorded. Historical images
// without timing still have wall/size samples, but no invented work timings.
import { stages, stats } from './app-deploy-time.ts'
import type { Job } from '../packages/esbuild/compile.ts'
import type { Answer } from '../packages/esbuild/plan.ts'

export type Sample = {
  compiler: string
  source: string
  job: string
  at: string
  run: number
  phase: 'first' | 'warm'
  wall: number
  bytes: number
  timing: Record<string, number>
  work?: Record<string, number>
}

export let measure = async (
  job: string,
  endpoint: string,
  token: string,
  get: typeof fetch = fetch,
) => {
  let start = performance.now()
  let response = await get(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-yak-compiler-job': '1',
      authorization: `Bearer ${token}`,
    },
    body: job,
  })
  let text = await response.text()
  let wall = Math.round(performance.now() - start)
  if (!response.ok) {
    throw new Error(`compiler ${response.status}: ${text.slice(0, 400)}`)
  }
  let answer = JSON.parse(text) as Answer & { timing?: Record<string, number> }
  if (answer.errors.length) throw new Error(answer.errors.join('\n'))
  return {
    wall,
    bytes: new TextEncoder().encode(text).byteLength,
    timing: stages(response.headers.get('server-timing')),
    ...(answer.timing ? { work: answer.timing } : {}),
  }
}

if (import.meta.main) {
  let [path, compiler, source, count = '5', record = 'compile-results.jsonl'] =
    Deno.args
  let endpoint = Deno.env.get('COMPILER_URL')
  let token = Deno.env.get('COMPILER_TOKEN')
  if (!path || !compiler || !source || !endpoint || !token) {
    throw new Error(
      'need job.json compiler-sha source-sha and COMPILER_URL/COMPILER_TOKEN',
    )
  }
  let job = await Deno.readTextFile(path)
  let parsed = JSON.parse(job) as Job
  if (!parsed.ask || !parsed.catalog || parsed.shared !== true) {
    throw new Error(
      'capture the complete deploy Job, including catalog and shared:true',
    )
  }
  let hash = [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(job)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0')).join('')
  let samples: Sample[] = []
  for (let run = 0; run <= Number(count); run++) {
    let sample: Sample = {
      compiler,
      source,
      job: hash,
      at: new Date().toISOString(),
      run,
      phase: run ? 'warm' : 'first',
      ...await measure(job, endpoint, token),
    }
    await Deno.writeTextFile(record, JSON.stringify(sample) + '\n', {
      append: true,
    })
    samples.push(sample)
    console.log(JSON.stringify(sample))
  }
  console.log(
    JSON.stringify({
      compiler,
      first: samples[0].wall,
      warm: stats(samples.slice(1).map((s) => s.wall)),
    }),
  )
}
