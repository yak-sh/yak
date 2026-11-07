// The shell's Expo config: app.json made into the variant `YAKS_VARIANT`
// names (variants.ts), yaks.app's where it names none, stamped with the
// commit it is published from.
import { execSync } from 'node:child_process'
import type { ConfigContext, ExpoConfig } from 'expo/config'
import { configOf, variantOf } from './variants.ts'

let commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
})()

export default ({ config }: ConfigContext): ExpoConfig =>
  configOf(config as ExpoConfig, variantOf(process.env.YAKS_VARIANT), commit)
