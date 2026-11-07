// What every Wrangler door shares: the subcommand an argument list names, and
// what a failed run throws.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { command, failure } from './wrangler.ts'

test('the subcommand is the first argument past the --env flag, wherever it sits', () => {
  for (
    let args of [
      ['deploy'],
      ['deploy', '--env', 'staging'],
      ['--env', 'staging', 'deploy'],
      ['--env=staging', 'deploy'],
      ['-e', 'staging', 'deploy'],
    ]
  ) assertEquals(command(args), 'deploy')
  assertEquals(command(['--env', 'staging', 'dev']), 'dev')
  assertEquals(command(['secret', 'put', 'deploy']), 'secret')
})

test("Cloudflare's API failing is one fault whichever endpoint met it", () => {
  let down = (path: string) =>
    failure(['deployments', 'list'], {
      code: 1,
      output:
        `\x1b[31m✘ [ERROR]\x1b[0m Received a malformed response from the API\n\n  no healthy upstream\n  GET /accounts/a/workers/scripts/yak/${path} -> 503 Service Unavailable\n  Cloudflare Ray ID: 1`,
    })
  let [a, b] = [down('deployments'), down('versions?deployable=true')]
  assertEquals(
    [
      a.message,
      (a as { fault?: string }).fault,
      (b as { fault?: string }).fault,
    ],
    [
      "Cloudflare's API failed: GET /accounts/a/workers/scripts/yak/deployments -> 503 Service Unavailable",
      'cloudflare api failed',
      'cloudflare api failed',
    ],
  )
  let signedOut = failure(['deployments', 'list'], {
    code: 1,
    output: 'Not logged in.',
  })
  assertEquals(
    [signedOut.message, 'fault' in signedOut],
    ['wrangler deployments exited 1: Not logged in.', false],
  )
})
