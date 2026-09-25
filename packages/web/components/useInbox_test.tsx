// Exercise the real view hooks/transport: absence is a server answer, not an
// empty RAM cache; counts share ownership and watch/mute keeps row policy.
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { cache, landSub, type Sub, useRoute } from '../live.ts'
import { uuid } from '../types.ts'
import { useInboxCount } from './useInbox.ts'

type Frame = { sub?: string; unsub?: string; q?: string }
