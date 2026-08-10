// Opt-in account canary exercises the installed Codex app-server against a
// disposable store. The dummy Platform key is never sent to the network.
import { assertEquals } from '@std/assert'
import { accountService } from './accounts.ts'
import { codexIssuer, codexStore } from './codex_auth.ts'

Deno.test({
  name: 'Codex app-server logs in and out of a disposable account',
  ignore: Deno.env.get('TASKS_CODEX_ACCOUNT_CANARY') != '1',
  fn: async () => {
    let root = await Deno.makeTempDir()
    let service = accountService(
      codexStore(root),
      codexIssuer({ timeout: 10_000 }),
    )
    try {
      let status = await service.login({
        method: 'apiKey',
        apiKey: 'sk-tasks-disposable-canary',
      })
      assertEquals('state' in status && status.state, 'ready')
      assertEquals((await service.status()).auth, 'apiKey')
      assertEquals(
        (await service.credentials.get()).base,
        'https://api.openai.com/v1',
      )
      await service.close()
      service = accountService(
        codexStore(root),
        codexIssuer({ timeout: 10_000 }),
      )
      assertEquals((await service.status()).auth, 'apiKey')
      assertEquals((await service.logout()).state, 'signed_out')
    } finally {
      await service.close()
      await Deno.remove(root, { recursive: true })
    }
  },
})
