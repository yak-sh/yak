// The shell's bundle reaches into the repository for what it is made of: the
// kit's parts, the in-memory DOM they render into, the painter, and the
// Operator's drawing of its lines (workers/yak/operator-draw.ts). A
// `@yaks/<name>/<path>` import is the file packages/<name>'s package.json
// exports at `./<path>`. Every package the
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

// The file a package exports at a subpath, by its package.json.
const exported = (name) => {
  let [, pkg, sub] = name.match(/^@yaks\/([^/]+)(?:\/(.+))?$/) ?? []
  if (!pkg) return null
  let dir = path.join(repo, 'packages', pkg)
  let file = path.join(dir, 'package.json')
  if (!fs.existsSync(file)) return null
  // `exports` is a map of subpaths, or the one file a package exports.
  let exports = JSON.parse(fs.readFileSync(file, 'utf8')).exports
  let to = typeof exports == 'string'
    ? sub ? null : exports
    : exports?.[sub ? `./${sub}` : '.']
  return typeof to == 'string' ? path.join(dir, to) : null
}
const own = [
  'preact',
  '@preact/signals',
  'react',
  'react-native',
  'lucide',
  'sucrase',
  'marked',
]
const here = path.join(__dirname, 'index.ts')

// What the shell gives in place of a package's file: @yaks/api/asset reads a
// file through the module loader, which a React Native bundle lacks.
const hosted = {
  '@yaks/api/asset': path.join(__dirname, 'asset.ts'),
}

config.resolver.resolveRequest = (context, name, platform) => {
  if (hosted[name]) return { type: 'sourceFile', filePath: hosted[name] }
  let file = exported(name)
  if (file) return { type: 'sourceFile', filePath: file }
  if (context.originModulePath.startsWith(path.join(repo, 'packages') + '/')) {
    if (name == 'react-dom/client') {
      return {
        type: 'sourceFile',
        filePath: path.join(repo, 'packages/preact/client.ts'),
      }
    }
    let compat = {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    }
    name = compat[name] ?? name
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
