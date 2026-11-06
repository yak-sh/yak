// Every account on a machine is found: the environment's, the ones listed,
// and each `~/.claude*` and `~/.codex*` holding transcripts.
import { equal, test } from '@yaks/testing'
import { held, homes } from './files.ts'
import { accountEid } from '@yaks/model'

let at = Deno.makeTempDirSync()
let make = (...paths: string[]) => {
  for (let p of paths) Deno.mkdirSync(`${at}/${p}`, { recursive: true })
}
make(
  'h/.claude/projects/-p',
  'h/.claude-work/projects/-p/s1',
  'h/.claude-empty/sessions',
  'h/.codex/sessions/2026/11/06',
  'h/.codex-2/sessions',
  'h/.cache/projects',
  'elsewhere/claude/projects',
  'elsewhere/codex/sessions',
)
Deno.writeTextFileSync(`${at}/h/.claude-work/projects/-p/s1.jsonl`, '{}\n')
Deno.writeTextFileSync(
  `${at}/h/.codex/sessions/2026/11/06/rollout-2026-11-06T10-00-00-0199a213-81c0-7800-8aa1-bbab2a035a53.jsonl`,
  '{}\n',
)
let env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] })
let h = `${at}/h`
let found = (listed: string[], vars: Record<string, string>, find = true) =>
  homes(listed, find, env({ HOME: h, ...vars }))
    .then((hs) => hs.map((x) => `${x.runner} ${x.dir.slice(at.length)}`))

test('each account directory under home holding transcripts is found', async () =>
  equal(await found([], {}), [
    'claude /h/.claude',
    'codex /h/.codex',
    'claude /h/.claude-work',
    'codex /h/.codex-2',
  ]))

test('the environment names one, and a listed one is known by what it holds', async () =>
  equal(
    await found([`${at}/elsewhere/codex/`, `${at}/elsewhere/claude`], {
      CLAUDE_CONFIG_DIR: `${h}/.claude-work`,
    }),
    [
      'claude /h/.claude-work',
      'codex /h/.codex',
      'codex /elsewhere/codex',
      'claude /elsewhere/claude',
      'claude /h/.claude',
      'codex /h/.codex-2',
    ],
  ))

test('with find off, only the listed accounts', async () =>
  equal(await found(['~/.codex-2'], {}, false), ['codex /h/.codex-2']))

test('each transcript keeps its account', async () => {
  let hs = await homes([], true, env({ HOME: h }))
  equal(
    (await held(hs)).map((f) => [f.id, f.runner ?? 'claude', f.account]),
    [
      [
        '0199a213-81c0-7800-8aa1-bbab2a035a53',
        'codex',
        accountEid(`${h}/.codex`),
      ],
      ['s1', 'claude', accountEid(`${h}/.claude-work`)],
    ],
  )
})
