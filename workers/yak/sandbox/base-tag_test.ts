import { equal, test } from '@yaks/testing'
import { pinned, tag } from './base.ts'

let dockerfile = Deno.readTextFileSync(
  new URL('./base/Dockerfile', import.meta.url),
)
let configuration = Deno.readTextFileSync(
  new URL('../wrangler.toml', import.meta.url),
)
let image = pinned(configuration)!
test('the sandbox names the base its Dockerfile hashes to', () => {
  equal(image.split('/').at(-1), `yak-sandbox:${tag(dockerfile)}`)
})
