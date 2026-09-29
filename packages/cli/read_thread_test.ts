/// <reference lib="deno.ns" />
// The web reader sees committed graph rows through its own connection.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { read } from './config.ts'
import { compose } from './host.ts'
import { readThread } from './read_thread.ts'

test('the web reader sees commits and closes after a refused query', async () => {
  let dir = await Deno.makeTempDir()
  let file = `${dir}/yak.json`
  await Deno.writeTextFile(
    file,
    JSON.stringify({ db: 'yak.db', plugins: ['@yaks/doc', '@yaks/process'] }),
  )
  let host = await compose(read(file), ['graph'])
  let reader = readThread(file)
  try {
    let processes = (await host.graph.read('.process')).length
    await host.graph.apply([{
      entity: { eid: 'one' },
      doc: { title: 'First' },
    }])
    assertEquals(
      (await reader.read('.doc.title=First')).map((b) => b.entity.eid),
      ['one'],
    )
    assertEquals((await host.graph.read('.process')).length, processes)
    await host.graph.apply([{
      entity: { eid: 'two' },
      doc: { title: 'Second' },
    }])
    assertEquals(
      (await reader.read('.doc')).map((b) => b.entity.eid),
      ['one', 'two'],
    )
    assertEquals((await reader.get(['two']))[0].doc, {
      title: 'Second',
      body: null,
    })
    await assertRejects(() => Promise.resolve(reader.read('.unknown')))
  } finally {
    await reader.close()
    await host.close()
    let broken = readThread(`${dir}/missing.json`)
    await assertRejects(() => Promise.resolve(broken.read('.doc')))
    await broken.close()
    await Deno.remove(dir, { recursive: true })
  }
})
