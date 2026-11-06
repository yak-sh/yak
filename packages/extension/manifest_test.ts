import { equal, match, test } from '@yaks/testing'
import { manifest } from './manifest.ts'

test("the manifest reaches its host and the host's spaces, and asks for the rest", () => {
  let m = manifest({
    name: 'yak.sh',
    origin: 'https://yak.sh',
    socket: 'wss://yak.sh/{space}/browser',
  })
  equal(m.host_permissions, ['https://yak.sh/*', 'https://*.yak.sh/*'])
  equal(m.optional_host_permissions, ['*://*/*'])
  match(m, { manifest_version: 3, name: 'yak.sh' })
  match(m.version, /^\d+(\.\d+){0,3}$/)
})
