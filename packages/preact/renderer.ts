/** The module names the Preact renderer supplies to an app. @module */

import manifest from './package.json' with { type: 'json' }
import * as preact from 'preact'
import * as hooks from 'preact/hooks'
import * as compat from 'preact/compat'
import * as client from 'preact/compat/client'
import * as jsx from 'preact/jsx-runtime'
import { draw } from './draw.ts'

/** Package aliases for a view selected to run on Preact. */
export let aliases: Record<string, string> = manifest.yaksRenderer.aliases

/** The renderer modules an app can import from its host. */
export let modules: Record<string, object> = {
  preact,
  'preact/hooks': hooks,
  'preact/compat': compat,
  'preact/compat/client': client,
  'preact/jsx-runtime': jsx,
  react: compat,
  'react/jsx-runtime': jsx,
}

/** Draw a component loaded from a Preact app into a host's tree. */
export let paint = <Props extends object>(
  view: unknown,
  props: Props,
  into: Element,
): () => void =>
  draw(preact.h(view as preact.ComponentType<Props>, props), into)
