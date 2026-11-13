// A served page shows each `data-copy` element's snippet from its release's
// copy.json (page-copy.ts): an app's files, a page its worker made, and a
// draft's preview, which fills from the draft's copy.
import { cleanup, equal, test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { connector, seed, unique } from './probe.ts'
import { serverSource, workerKernel } from './worker-probe.ts'

let worker = 'data:text/javascript,' + encodeURIComponent(`export default {
  fetch: (req) => new URL(req.url).pathname.endsWith('/made')
    ? new Response('<p data-copy="hero.title">From the worker</p>',
      { headers: { 'content-type': 'text/html' } })
    : new Response(null, { status: 404 }),
}`)
let k = await workerKernel(new URL(worker))
cleanup(() => k.stop())

let space = unique('copy')
let { cookie } = await seed(k, [{
  slug: space,
  apps: ['front', 'words', 'plain', 'made'],
}])
let agent = connector(k, cookie)
let host = `${space}.yaks.app`
let page = async (path: string) => {
  let r = await k.at(host, path)
  equal(r.status, 200, path)
  return await r.text()
}

let index = '<h1 data-copy="hero.title">Typed</h1>' +
  '<p data-copy="hero.lost">Kept as written</p>' +
  '<a href="./" data-copy-title="hero.tip" title="old">home</a>'
let copy = (title: string) =>
  JSON.stringify({ hero: { title, tip: 'Back to the start' } }, null, 2) +
  '\n'
let deploy = async (
  app: string,
  files: { path: string; content: string }[],
) => {
  await agent.tool('app_files', { space, app, files })
  await agent.tool('app_deploy', { space, app })
}
await deploy('words', [
  { path: 'index.html', content: index },
  { path: 'copy.json', content: copy('Build, host and share web apps') },
])
await deploy('plain', [{ path: 'index.html', content: index }])
await deploy('made', [
  serverSource,
  { path: 'copy.json', content: copy('Made by its worker') },
])

test("an app's page shows its release's copy, and keeps what the copy lacks", async () => {
  let html = await page('/words/')
  assertStringIncludes(
    html,
    '<h1 data-copy="hero.title">Build, host and share web apps</h1>',
  )
  assertStringIncludes(html, '<p data-copy="hero.lost">Kept as written</p>')
  assertStringIncludes(html, 'title="Back to the start"')
})

test('copy.json is served as a file, for a script that draws text', async () => {
  equal(
    JSON.parse(await page('/words/copy.json')).hero.title,
    'Build, host and share web apps',
  )
})

test('an app with no copy.json serves its page as written', async () => {
  assertStringIncludes(await page('/plain/'), index)
})

test("a page an app's worker made shows the app's copy", async () => {
  assertStringIncludes(
    await page('/made/made'),
    '<p data-copy="hero.title">Made by its worker</p>',
  )
})

test("a draft's preview shows the draft's copy, and the release keeps its own", async () => {
  await agent.tool('app_files', {
    space,
    app: 'words',
    path: 'copy.json',
    content: copy('A drafted title'),
  })
  let { value } = await agent.answer('app_preview', {
    space,
    app: 'words',
    screenshot: false,
  })
  let url = new URL(String(value!.url))
  let preview = await k.at(url.hostname, url.pathname, {
    headers: { cookie },
  })
  assertStringIncludes(
    await preview.text(),
    '<h1 data-copy="hero.title">A drafted title</h1>',
  )
  assertStringIncludes(
    await page('/words/'),
    '<h1 data-copy="hero.title">Build, host and share web apps</h1>',
  )
})
