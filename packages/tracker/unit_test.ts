// A tracker restart must cover outbound mail without a session-owned worker.
import { ok, test } from '@yaks/testing'

let unit = await Deno.readTextFile(
  new URL('./yak-tracker@.service', import.meta.url),
)
let command = unit.split('\n').find((line) => line.startsWith('ExecStart=')) ??
  ''
let roles = command.match(/--roles ([^ ]+)/)?.[1].split(',') ?? []

test('the tracker systemd worker durably serves intake, effects and mail', () => {
  for (let role of ['effects', '@yaks/tracker', '@yaks/mail']) {
    ok(roles.includes(role))
  }
  ok(command.includes('--config %h/.yak/tracker.json'))
  ok(command.includes('--ready %t/yak-tracker-%i.ready'))
})
