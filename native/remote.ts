// The packages the shell carries for a kit-built app's view, which
// @yaks/native/remote loads from the app itself, so a deploy reaches the phone
// without a new shell: the app's `"platform"` packages are these copies, the
// ones the shell's in-memory DOM is rendered by.
import * as preact from 'preact'
import * as hooks from 'preact/hooks'
import * as ui from '@yaks/ui'
import type { Carried } from '@yaks/native/remote'

export let carried: Carried = { preact, 'preact/hooks': hooks, '@yaks/ui': ui }
