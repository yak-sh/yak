import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { configOf, shown, variantOf } from './variants.ts'

let base = {
  name: 'shell',
  slug: 'yaks-app',
  plugins: ['expo-status-bar'],
  ios: { supportsTablet: true },
  updates: { url: 'https://u.expo.dev/p' },
  extra: { eas: { projectId: 'p' } },
}

test('a variant makes the shell its own app, on its own channel', () => {
  let made = configOf(base, {
    ...variantOf('checks'),
    team: 'TEAM1',
    icon: 'checks.png',
    plugins: ['expo-location'],
  })
  equal(made.name, 'Checks')
  equal(made.slug, 'yaks-app')
  equal(made.icon, 'checks.png')
  equal(made.plugins, ['expo-status-bar', 'expo-location'])
  equal(made.ios, {
    supportsTablet: true,
    bundleIdentifier: 'app.yaks.checks',
    appleTeamId: 'TEAM1',
  })
  equal(made.updates, {
    url: 'https://u.expo.dev/p',
    requestHeaders: { 'expo-channel-name': 'checks' },
  })
  equal(made.extra.eas, { projectId: 'p' })
  equal((made.extra.variant as { space: string }).space, 'checks')
})

test('no variant named is yaks.app, and a name with no variant refuses', () => {
  let made = configOf(base, variantOf(''))
  equal([made.name, made.ios.bundleIdentifier], ['yaks.app', 'app.yaks'])
  equal('appleTeamId' in made.ios, false)
  assertThrows(() => variantOf('nowhere'), Error, 'names no variant')
})

test('a variant shows its own space alone, with the apps it carries', () => {
  let apps = (...slugs: string[]) => slugs.map((slug) => ({ slug }))
  let spaces = [
    { slug: 'ada', apps: apps('notes') },
    { slug: 'checks', apps: apps('permits', 'parks') },
  ]
  let slugs = (v: Parameters<typeof shown>[0]) =>
    shown(v, spaces).map((s) => [s.slug, s.apps.map((a) => a.slug)])
  equal(slugs(variantOf()), [['ada', ['notes']], ['checks', [
    'permits',
    'parks',
  ]]])
  equal(slugs(variantOf('checks')), [['checks', ['permits', 'parks']]])
  equal(slugs({ ...variantOf('checks'), apps: ['parks'] }), [['checks', [
    'parks',
  ]]])
})
