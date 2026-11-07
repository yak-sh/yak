// What a tool says about itself, out of tools.yml: the rows each tool module
// declares, worn with their words. Apart from tool.ts, whose refusals every
// door uses, so a page that only serves a space never compiles the words
// (content.ts) or the YAML filling them (T-148886).
import type { Steps } from '@yaks/tools/title'
import { fill } from '@yaks/yaml'
import { WORDS } from './content.ts'
import type { Tool } from './tool.ts'

/** What a tool says about itself: one entry of tools.yml, under the tool's own
 * name. The words are the file's; everything else about a row is code's. */
export type Words = {
  title: string
  step?: Steps
  description: string
}

/**
 * A row as it is written: everything but the words. `worded` puts those on,
 * out of tools.yml — the Rails-locale shape of M-34605, where the code refers
 * to a key and the file holds the sentence.
 */
export type Row = Omit<Tool, 'title' | 'step' | 'description'> & {
  /** what a `{{slot}}` in those words stands for, for the few rows whose
   * description is not a constant — `guide` names the pages there are today. */
  slots?: Record<string, string>
}

/**
 * A row wearing its words. A name tools.yml says nothing about throws at
 * module load, which is the test run, the bundle and the boot — so a row added
 * without its words is a build that fails and never a tool that lists blank.
 */
export let worded = (row: Row): Tool => {
  let said = WORDS[row.name]
  if (!said) throw new Error(`tools.yml says nothing about ${row.name}`)
  let { slots, ...rest } = row
  return {
    ...rest,
    title: said.title,
    ...said.step ? { step: said.step } : {},
    description: fill(said.description, slots),
  }
}
