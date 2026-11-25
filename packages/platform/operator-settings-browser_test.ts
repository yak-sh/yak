import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { bindSettings } from './operator-settings-browser.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import {
  alertingEid,
  operatorSettings,
  settingsEid,
  settingsRow,
} from './operator-settings.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  ADA,
  lines,
  operatorRows,
  operatorView,
  page,
  SPACE,
} from './operator-settings_fixture_test.ts'

// The settings page bound to a page graph holding `rows`, each write
// answered by `answer`, and this browser allowed as `allow` says.
let bound = (
  { view = operatorView(), rows = operatorRows(), answer = ok, allow = sub } =
    {},
) => {
  let root = page(view, rows)
  let g = graph(answer)
  for (let [line, held] of lines(rows)) g.set(line, held)
  let allowed: string[] = []
  bindSettings(root, g, (key) => (allowed.push(key), allow()))
  let save = (id: string, fields: Record<string, string>) => {
    let body = new FormData()
    for (let [k, v] of Object.entries(fields)) body.set(k, v)
    return root.querySelector<SavingForm>(`form#${id}`)![SAVE_THROUGH]!(body)
  }
  return { root, g, save, allowed }
}
let ok = (b: Bundle[]) => Promise.resolve(b)
let sub = () => Promise.resolve({ endpoint: 'https://push.test/1' })
let wrote = (g: ReturnType<typeof bound>['g']) =>
  g.wrote.map((b) =>
    b.map(({ entity, ...comps }) =>
      entity.eid == settingsEid(SPACE) || entity.eid == alertingEid(ADA)
        ? { eid: entity.eid, ...comps }
        : comps
    )
  )

test('a name saved goes to the Operator as its settings, and the page goes by the name the graph holds', async () => {
  let { root, g, save } = bound()
  await save('name', { name: 'Caleb' })
  equal(wrote(g), [[{
    eid: settingsEid(SPACE),
    operatorSettings: { space: SPACE, name: 'Caleb' },
  }]])
  // The Operator renames itself.
  g.set(operatorSettings(SPACE), [settingsRow(SPACE, { name: 'Iris' })])
  equal(
    root.querySelector<HTMLInputElement>('#name [name=name]')?.value,
    'Iris',
  )
  equal(root.textContent!.includes('Iris is this space’s Operator.'), true)
})

test('a setting the Operator refuses is said on the Save bar, and one that could not reach it is kept', async () => {
  let refused = (b: Bundle[]) =>
    Promise.reject(
      new WriteRefused(b, {
        error: 'arguments',
        message: 'Pick one of the voices listed.',
      } as never),
    )
  let { save } = bound({ answer: refused })
  let said = await save('voice', { voice: 'nobody' }).catch((e) => e.message)
  equal(said, 'Pick one of the voices listed.')
})

test('choosing browser notifications allows this browser first, then saves the choice', async () => {
  let { g, save, allowed } = bound({
    view: operatorView({ key: 'vapid' }),
  })
  await save('alerts', { channel: 'push' })
  equal(allowed, ['vapid'])
  equal(wrote(g), [[
    { allowPush: { subscription: { endpoint: 'https://push.test/1' } } },
    { eid: alertingEid(ADA), alerting: { channel: 'push' } },
  ]])
  let other = bound({ view: operatorView({ key: 'vapid' }) })
  await other.save('alerts', { channel: 'email' })
  equal([other.allowed, wrote(other.g)], [[], [[{
    eid: alertingEid(ADA),
    alerting: { channel: 'email' },
  }]]])
})

test('a number is agreed to in the space, and Stop texts stops them', async () => {
  let texting = { number: '+12695550142', at: '2026-11-01T00:00:00Z' }
  let { root, g, save } = bound({ rows: operatorRows({ texting }) })
  await save('texts', {
    number: '269-555-0199',
    agreed: 'yes',
    code: ' 123456 ',
  })
  root.querySelector<HTMLElement>('[data-stop-texts]')!.click()
  await Promise.resolve()
  equal(wrote(g), [
    [{
      agreeTexts: {
        space: SPACE,
        number: '269-555-0199',
        agreed: true,
        code: '123456',
      },
    }],
    [{ stopTexts: {} }],
  ])
})

test('until each row is in, the page stays as the server drew it', () => {
  let root = page()
  let before = root.innerHTML
  let g = graph(ok)
  bindSettings(root, g)
  equal(root.innerHTML, before)
})
