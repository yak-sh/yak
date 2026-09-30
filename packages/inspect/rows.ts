/**
 * What every answer read on a page shares: its rows, and what shows in their
 * place while it is out or after it was refused.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Rows } from '@yaks/ui'
import type { Answer, Bundle } from './host.ts'

/** The answer's rows, or none while it is out. */
export let rows = (a?: Answer): Bundle[] => a?.rows ?? []

/** What shows in place of an answer that is refused or not in yet; null
 * once it can be drawn. */
export let waiting = (a?: Answer): JSX.Element | null =>
  a?.error
    ? h(Rows.More, {}, a.error)
    : !a?.ready && !a?.rows.length && a?.count == null && !a?.tally
    ? h(Rows.More, {}, '…')
    : null

/** What a table with no rows says. */
export let none = (): JSX.Element => h(Rows.More, {}, 'none')
