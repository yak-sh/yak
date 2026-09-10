// The launcher's workspace resolver (sessions.ts projectRepo): a spawn cuts its
// worktree from the repo its task's PROJECT names, and nowhere else. T-35222
// found the refusal unactionable — P-32322 (yak.sh) carried no `repo` component
// and the launch died with "set repo.path first", naming neither the project
// nor the door that sets it. These assert the resolved checkout, and that the
// gap names the command closing it.
import { assertEquals, assertMatch } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')

let { apply, human } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { projectRepo } = await import('./sessions.ts')

let uid = () => crypto.randomUUID()
// A project entity carrying whatever repo columns the case is about.
let project = (repo?: Record<string, string>) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'yaks.app' } },
    { eid, name: 'project', comp: {} },
    ...(repo ? [{ eid, name: 'repo', comp: repo }] : []),
  ])
  return eid
}
let refusal = (eid: string) => {
  let got = projectRepo(eid)
  return 'error' in got ? got.error : ''
}

Deno.test('a project naming a whole repo resolves to its checkout', () => {
  let eid = project({ path: '/home/yaks/code/tasks', base_branch: 'main' })
  assertEquals(projectRepo(eid), {
    path: '/home/yaks/code/tasks',
    base_branch: 'main',
  })
})

Deno.test('a project with no repo is told what to set, by id', () => {
  let eid = project()
  let said = refusal(eid)
  let id = human(db, eid)
  assertEquals(
    said,
    `${id} has no repo — set it: task set ${id} .repo.path=<absolute path>`,
  )
  assertMatch(said, /^[0-9a-f]{8} /)
})
