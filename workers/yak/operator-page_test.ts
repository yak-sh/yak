import { equal, test } from '@yaks/testing'
import { installing } from './operator-page.ts'

test('a space installs as its Operator, wearing its logo where it has one', async () => {
  let sha = 'a'.repeat(64)
  let icons = async (logo: unknown) => {
    let space = { slug: 'ada', title: 'Ada', operator: 'Jeeves', logo }
    let made = await installing(space as never).json()
    return [made.short_name, made.icons.map((i: { src: string }) => i.src)]
  }
  equal(await icons(null), ['Jeeves', ['/connector-512.png']])
  equal(await icons({ sha, type: 'image/png' }), [
    'Jeeves',
    [`/manage/ada/logo/${sha}?size=icon`],
  ])
})
