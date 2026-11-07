// The shell's bundle reaches into the repository for what it is made of: the
// kit's parts, the in-memory DOM they render into, and the painter. `@yaks/ui` resolves to its parts alone
// (packages/ui/parts.ts), the entry for a host that serves its look from
// elsewhere, as this one does through @yaks/native's look. Every package the
// shell itself holds (React, React Native, Preact) resolves from here, so a
// file in packages/ shares the shell's one copy.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const repo = path.resolve(__dirname, '..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [path.join(repo, 'packages')]

const hosted = {
  '@yaks/ui': 'packages/ui/parts.ts',
  '@yaks/ui/parts': 'packages/ui/parts.ts',
  '@yaks/tui/dom': 'packages/tui/dom.ts',
  '@yaks/native': 'packages/native/mod.ts',
}
const own = ['preact', 'react', 'react-native', 'lucide']
const here = path.join(__dirname, 'index.ts')

config.resolver.resolveRequest = (context, name, platform) => {
  if (hosted[name]) {
    return { type: 'sourceFile', filePath: path.join(repo, hosted[name]) }
  }
  if (own.some((p) => name == p || name.startsWith(p + '/'))) {
    return context.resolveRequest(
      { ...context, originModulePath: here },
      name,
      platform,
    )
  }
  return context.resolveRequest(context, name, platform)
}

module.exports = config
