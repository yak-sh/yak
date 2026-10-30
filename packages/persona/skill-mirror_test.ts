import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { fileOf } from '@yaks/file'
import { localFilesystem, repositoryEid } from '@yaks/git/host'
import type { Run } from '@yaks/git/land'
import { syncSkills } from './skill-mirror.ts'
import { renderSkill } from './skill-text.ts'
import { world } from './testing.ts'

let PATH = '.claude/skills/held/SKILL.md'

// A checkout on disk whose Git answers are given, with one skill in the graph
// whose locator's id is `link`, its file agreed with what the graph renders.
let checkout = async (link: string) => {
  let g = world()
  let root = await Deno.realPath(await Deno.makeTempDir())
  let memo = `${await Deno.makeTempDir()}/memo.json`
  await Deno.mkdir(`${root}/.git`)
  await Deno.mkdir(`${root}/.claude/skills/held`, { recursive: true })
  let repository = repositoryEid(
    `${root}/.git`,
    (await localFilesystem(g)).entity.eid,
  )
  let file = fileOf(repository, PATH)
  let parts = {
    doc: { title: 'held', body: 'About held\n' },
    content: { body: 'Instructions\n' },
    skill: {},
  }
  await g.apply([
    { entity: { eid: 'skill' }, ...parts },
    { entity: { eid: file }, file: { path: PATH, root: repository } },
    {
      entity: { eid: link },
      edge: { from: 'skill', to: file },
      references: {},
    },
  ] as Bundle[])
  let run: Run = (args) =>
    Promise.resolve({
      ok: true,
      code: 0,
      err: '',
      out: args[0] == 'rev-parse'
        ? `false\n${root}\n${root}/.git\n${root}/.git\nrefs/heads/main\n`
        : `100644 ${'0'.repeat(40)} 0\t${PATH}\0`,
    })
  let write = (text: string) => Deno.writeTextFile(`${root}/${PATH}`, text)
  await write(renderSkill(parts as never))
  let sync = () => syncSkills(g, root, memo, { run })
  assertEquals((await sync()).conflicts, [])
  return { g, sync, write, file }
}

test('an edited skill imports through the locator it holds, whatever its id', async () => {
  let former = derivedEid('a locator from before edges derived their ids')
  let { g, sync, write, file } = await checkout(former)
  await write(`---\nname: held\ndescription: About held\n---\nEdited\n`)
  let { conflicts, failed, read } = await sync()
  assertEquals({ conflicts, failed, read: read.length }, {
    conflicts: [],
    failed: [],
    read: 1,
  })
  assertEquals(
    (await g.read(`.references&.edge.to=${file}`)).map((b) => b.entity.eid),
    [former],
  )
  let [skill] = await g.get(['skill'], ['content'])
  assertEquals((skill.content as { body: string }).body.trim(), 'Edited')
})
