// Keep installed checkout shims working while the shared workspace installer
// lives with the CLI.
export * from '@yaks/cli/dependencies'
import { ready } from '@yaks/cli/dependencies'
import * as system from '@yaks/process/system'
import { fileURLToPath } from 'node:url'

if (system.main(import.meta.url)) {
  await ready(fileURLToPath(new URL('../../', import.meta.url)), system.args[0])
}
