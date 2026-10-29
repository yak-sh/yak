import { equal, test } from '@yaks/testing'
import { rows } from './platform-analytics.ts'

let a = '00000000-0000-0000-0000-000000000001'
let b = '00000000-0000-0000-0000-000000000002'
test('analytics fixture answers per-app and grouped queries with app identities', () => {
  equal(rows(`SELECT time AS day WHERE index1 = '${a}'`, '2026-10-29'), [
    { app: a, day: '2026-10-29', views: 42 },
  ])
  equal(
    rows(`SELECT blob3 AS path WHERE index1 IN ('${a}', '${b}')`, '2026-10-29'),
    [
      { app: a, path: '/notes/', views: 42 },
      { app: b, path: '/notes/', views: 42 },
    ],
  )
})
