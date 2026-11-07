// The shell's bundle reaches into the repository for what it is made of: the
// kit's parts, the in-memory DOM they render into, the painter, and the
// Operator's drawing of its lines (workers/yak/operator-draw.ts). A
// `@yaks/<name>/<path>` import is the file packages/<name>'s package.json
// exports at `./<path>`, except `@yaks/ui`, which resolves to its parts alone
// (packages/ui/parts.ts), the entry for a host that serves its look from
// elsewhere, as this one does through @yaks/native's look. Every package the
// shell itself holds (React, React Native, Preact) resolves from here, so a
// file in packages/ or workers/ shares the shell's one copy.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')
const fs = require('node:fs')

const repo = path.resolve(__dirname, '..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [
  path.join(repo, 'packages'),
  path.join(repo, 'workers', 'yak'),
]

const hosted = {
  '@yaks/ui': 'packages/ui/parts.ts',
}
// The file a package exports at a subpath, by its package.json.
const exported = (name) => {
  let [, pkg, sub] = name.match(/^@yaks\/([^/]+)(?:\/(.+))?$/) ?? []
  if (!pkg) return null
  let dir = path.join(repo, 'packages', pkg)
  let file = path.join(dir, 'package.json')
  if (!fs.existsSync(file)) return null
  let to = JSON.parse(fs.readFileSync(file, 'utf8')).exports
    ?.[sub ? `./${sub}` : '.']
  return typeof to == 'string' ? path.join(dir, to) : null
}
const own = ['preact', 'react', 'react-native', 'lucide', 'sucrase', 'marked']
const here = path.join(__dirname, 'index.ts')

config.resolver.resolveRequest = (context, name, platform) => {
  if (hosted[name]) {
    return { type: 'sourceFile', filePath: path.join(repo, hosted[name]) }
  }
  let file = exported(name)
  if (file) return { type: 'sourceFile', filePath: file }
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
