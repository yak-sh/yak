/// <reference lib="deno.ns" />
// The reference adapter answers the queries ./parity.ts holds every adapter
// to with the rows they mean, so agreeing with it is agreeing with the grammar.

import { test } from '@yaks/testing'
import { answers, rig } from './parity.ts'
import { store } from './testing.ts'

test('a sqlite graph selects what each query means', () =>
  answers(rig(store())))
