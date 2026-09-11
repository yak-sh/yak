/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from '@std/assert'
import { load, type Manifest, select } from './mod.ts'

Deno.test('one explicit manifest supplies independent subsystem selections lazily', async () => {
  const calls: string[] = []
  const manifest: Manifest = {
    api: 1,
    id: 'example',
    contributions: [
      {
        name: 'schema',
        target: 'vocabulary',
        load: () => {
          calls.push('schema')
          return {}
        },
      },
      {
        name: 'server',
        target: 'services',
        requires: ['listen'],
        load: () => {
          calls.push('server')
          return {}
        },
      },
    ],
  }
  const plugins = await load(
    [{ id: 'example', specifier: 'example@1/plugin' }],
    (specifier) => {
      assertEquals(specifier, 'example@1/plugin')
      return Promise.resolve({ default: manifest })
    },
  )
  assertEquals(calls, [])
  assertEquals((await select(plugins, 'vocabulary')).map((c) => c.name), [
    'schema',
  ])
  await assertRejects(
    () => select(plugins, 'services'),
    Error,
    'requires listen',
  )
  assertEquals(calls, ['schema'])
  await select(plugins, 'services', ['listen'])
  assertEquals(calls, ['schema', 'server'])
})

Deno.test('config disables imports and rejects duplicate or mismatched registrations', async () => {
  const resolve = () =>
    Promise.resolve({
      default: { api: 1, id: 'x', contributions: [] } as Manifest,
    })
  assertEquals(
    await load([{ id: 'x', specifier: 'unused', enabled: false }], () => {
      throw Error('imported')
    }),
    [],
  )
  await assertRejects(
    () =>
      load([{ id: 'x', specifier: 'x' }, { id: 'x', specifier: 'x' }], resolve),
    Error,
    'Duplicate plugin',
  )
  await assertRejects(
    () => load([{ id: 'other', specifier: 'x' }], resolve),
    Error,
    'mismatched',
  )
  await assertRejects(
    () =>
      load([{ id: 'x', specifier: 'x' }], () =>
        Promise.resolve({
          default: {
            api: 1,
            id: 'x',
            contributions: [
              { name: 'same', target: 'a', load: () => 1 },
              {
                name: 'same',
                target: 'b',
                load: () => 2,
              },
            ],
          },
        })),
    Error,
    'Duplicate contribution',
  )
})
