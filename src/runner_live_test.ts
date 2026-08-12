// Gated end-to-end canary: the direct provider loop calls a hosted local tool
// and resumes without Codex CLI state. Auth is read from a file by the HTTP
// edge; the command environment receives neither its path nor its contents.
import { assertEquals } from '@std/assert'
import { type EntrySpec } from './entries.ts'
import { localTools } from './harness_tools.ts'
import { type Credential, responses } from './responses.ts'
import { type EntryRow, runTurn } from './runner.ts'

let authFile = Deno.env.get('TASKS_CODEX_CANARY_AUTH')

let auth = (): Credential => {
  let value = JSON.parse(Deno.readTextFileSync(authFile!))
  return {
    token: value.tokens?.access_token,
    account: value.tokens?.account_id,
  }
}

Deno.test({
  name: 'live runner executes and resumes one hosted shell call',
  ignore: !authFile,
  fn: async () => {
    let tree = await Deno.makeTempDir({ prefix: 'tasks-runner-live-' })
    let credential = auth()
    let entries: EntryRow[] = [{
      eid: 'input',
      seq: 1,
      comps: {
        message: { role: 'user' },
        content: {
          body:
            'Call shell exactly once with command `printf CANARY_TOOL`, cwd null, and timeout_ms 10000. Then reply with exactly CANARY_OK.',
        },
      },
    }]
    let next = 1
    let tools = await localTools({ tree })
    try {
      let out = await runTurn({
        log: {
          read: () => Promise.resolve(structuredClone(entries)),
          append: (specs: EntrySpec[]) => {
            let eids = specs.map((spec) => {
              let eid = `entry-${next++}`
              entries.push({ eid, seq: entries.length + 1, comps: spec })
              return eid
            })
            return Promise.resolve(eids)
          },
        },
        through: 'input',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        effort: 'low',
        instructions:
          'Use the shell tool exactly as requested. After its result, return only the requested final marker.',
        transport: responses({
          base: 'https://chatgpt.com/backend-api/codex',
          credentials: { get: () => Promise.resolve(credential) },
          headers: {
            originator: 'tasks',
            version: Deno.env.get('TASKS_CODEX_CANARY_VERSION') ?? '0',
          },
          retries: 0,
        }),
        tools,
        maxGenerations: 3,
      })
      assertEquals(out.finalText.trim(), 'CANARY_OK')
      assertEquals(
        entries.some((entry) => entry.comps.result?.call),
        true,
      )
      let durable = JSON.stringify(entries)
      for (
        let secret of [credential.token, credential.account, authFile]
          .filter(Boolean) as string[]
      ) assertEquals(durable.includes(secret), false)
    } finally {
      await tools.close?.()
      await Deno.remove(tree, { recursive: true })
    }
  },
})
