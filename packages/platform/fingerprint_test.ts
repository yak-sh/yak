// What a release serves each browser file as (fingerprint.ts), read through a
// bucket that answers when the test lets it: no network.
import { equal, test } from '@yaks/testing'
import { fingerprints } from './fingerprint.ts'

// Stylesheets read a few at a time, ahead of the walk that needs them, rather
// than each after the last (T-3600); what they serve is the same.
test('a release reads its stylesheets a few at a time, and serves each the same', async () => {
  let files = Object.fromEntries(
    [...Array(10).keys()].map((i) => [`s${i}.css`, `sha${i}`]),
  )
  let open = 0, most = 0
  let read = async (sha: string) => {
    most = Math.max(most, ++open)
    await new Promise((go) => setTimeout(go, 1))
    open--
    return `.${sha} {}`
  }
  let assets = await fingerprints(files, {}, read, () => {
    throw new Error('nothing links, so nothing is written')
  })
  equal(Object.values(assets).map((a) => a.sha), Object.values(files))
  equal(most > 1 && most <= 7, true)
})
