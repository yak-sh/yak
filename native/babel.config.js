// Expo's preset, with TypeScript stripped first. The preset runs its Flow
// stripping on every file, TypeScript's too, and Flow refuses a `declare`
// class field, which packages/ written for Deno use (@yaks/graph errors.ts).
// A project's plugins run before its presets', so this strips TypeScript,
// `declare` fields included, before Flow sees the file.
const preset = require.resolve('babel-preset-expo')
const typescript = require.resolve('@babel/plugin-transform-typescript', {
  paths: [preset],
})
const strip = (isTSX) => [
  typescript,
  { isTSX, allowNamespaces: true, allowDeclareFields: true },
]

module.exports = (api) => {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      { test: (file) => !!file?.endsWith('.ts'), plugins: [strip(false)] },
      { test: (file) => !!file?.endsWith('.tsx'), plugins: [strip(true)] },
    ],
  }
}
