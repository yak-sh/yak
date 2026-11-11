import { derivedEid } from '@yaks/graph'

/** A phone row created by text sign-up belongs to its vouched texter across forms. */
export let texterEid = (submitter: string): string =>
  derivedEid('form-texter|' + submitter)
