import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { directoryCost, queryCost } from './query_cost_fixture.ts'

test('one-row Store query bills only its answer and lookups, cold and warm', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?query=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof queryCost>>
  console.log('QUERY_COST', JSON.stringify(report))
  for (let [name, value] of Object.entries(report)) {
    assertEquals(value.cost.written, 0)
    assert(
      value.cost.read <= (name == 'cold' ? 50 : 20),
      `${name}: ${value.cost.read} billed rows`,
    )
  }
})

test('directory routing reads one app rather than its space roster', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?directory-query=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof directoryCost>>
  console.log('DIRECTORY_QUERY_COST', JSON.stringify(report))
  for (let [name, value] of Object.entries(report)) {
    assertEquals(value.cost.written, 0)
    assert(
      value.cost.read <= (name == 'cold' ? 100 : 75),
      `${name}: ${value.cost.read} billed rows`,
    )
  }
})

test('a screened page seeks its answer without loading unrelated archetypes', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?query=1&screened=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof queryCost>>
  console.log('SCREENED_QUERY_COST', JSON.stringify(report))
  for (let [name, value] of Object.entries(report)) {
    assertEquals(value.cost.written, 0)
    assert(
      value.cost.read <= (name == 'cold' ? 60 : 40),
      `${name}: ${value.cost.read} billed rows`,
    )
  }
})

test('the full page query accounts for stale installation and uses lookup', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?query=1&stale=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof queryCost>>
  console.log('FULL_QUERY_COST', JSON.stringify(report))
  for (let [name, value] of Object.entries(report)) {
    assertEquals(value.cost.written, 0)
    assert(
      value.cost.read <= (name == 'cold' ? 60 : 40),
      `${name}: ${value.cost.read} full-route billed rows`,
    )
  }
})
