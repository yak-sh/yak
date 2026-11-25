// What a release serves each browser file as (fingerprint.ts), read through a
// bucket that answers when the test lets it: no network.
import { equal, test } from '@yaks/testing'
import { digest } from '@yaks/graph/sha256'
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

test('a release reuses unchanged assets and follows only the references that changed', async () => {
  let files = {
    'index.html': 'page',
    'style.css': 'style',
    'theme.css': 'theme',
    'logo.svg': 'logo',
    'plain.js': 'plain',
    'module.js': 'module',
  }
  let sources: Record<string, string> = {
    style: '@import "./theme.css";',
    theme: 'a { background: url(logo.svg), url(missing.svg) }',
    plain: 'export let n = 1',
    module: 'import "./plain.js"',
  }
  let reads: string[] = [], writes: string[] = []
  let release = (next: Record<string, string>, previous = {}) =>
    fingerprints(next, {}, (sha) => {
      reads.push(sha)
      return Promise.resolve(sources[sha])
    }, (text) => {
      writes.push(text)
      return digest(new TextEncoder().encode(text))
    }, previous)
  let start = await release(files)
  reads = []
  writes = []
  let page = await release({ ...files, 'index.html': 'new page' }, start)
  equal(page, start)
  equal([reads, writes], [[], []])

  let linked = await release({ ...files, 'missing.svg': 'now-present' }, page)
  equal(reads, ['theme', 'style'])
  equal(writes.length, 2)
  equal(writes[0].includes('now-present/missing.svg'), true)
  equal(linked['module.js'], start['module.js'])

  reads = []
  writes = []
  let { 'logo.svg': _, ...left } = files
  await release({ ...left, 'missing.svg': 'now-present' }, linked)
  equal(reads, ['theme', 'style'])
  equal(writes[0].includes('logo/logo.svg'), false)
})
