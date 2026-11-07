// The shell's Expo config: app.json made into the variant `YAKS_VARIANT`
// names (variants.ts), yaks.app's where it names none.
import type { ConfigContext, ExpoConfig } from 'expo/config'
import { configOf, variantOf } from './variants.ts'

export default ({ config }: ConfigContext): ExpoConfig =>
  configOf(config as ExpoConfig, variantOf(process.env.YAKS_VARIANT))
