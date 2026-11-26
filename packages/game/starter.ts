/** The scene used by the starter's play surface. */
export let gameViews = ['3d', 'voxel', '2d'] as const

export type GameStarter = {
  view?: typeof gameViews[number]
  multiplayer?: boolean
}

let shell = [
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest',
  'style.css',
  'screen.ts',
]
let scene = ['look.ts', 'frames.ts', 'world.ts', 'trees.ts']
let solo = ['main.ts', 'movement.ts', 'play.ts']
let room = [
  'room-page.ts',
  'room-client.ts',
  'room-model.ts',
  'room-rules.ts',
  'room-wire.ts',
  'vocab.json',
  'worker.ts',
]

/** The authored files read by the platform build. */
export let starterSources: string[] = [
  ...shell,
  ...scene,
  ...solo,
  ...room,
  'index.html',
  'room.html',
  'room-view.ts',
  'room-view-2d.ts',
  'board.ts',
  'board.html',
  'board-page.ts',
  'voxel-trees.ts',
  'package.json',
  'wrangler.json',
]

/** Select the app's first files from the authored starter. A multiplayer
 * variant uses one page for both the host and invited guests. */
export let gameStarter = (
  { view = '3d', multiplayer = false }: GameStarter,
  sources: Record<string, string>,
): { path: string; content?: string; base64?: string }[] => {
  let dimensional = view !== '2d'
  let paths = [
    ...shell,
    ...(dimensional ? scene : ['board.ts']),
    ...(multiplayer ? room : dimensional ? solo : ['board-page.ts']),
  ]
  let files = Object.fromEntries(paths.map((path) => [path, sources[path]]))
  files['index.html'] = sources[
    multiplayer ? 'room.html' : dimensional ? 'index.html' : 'board.html'
  ]
  if (multiplayer) {
    files['room-view.ts'] =
      sources[dimensional ? 'room-view.ts' : 'room-view-2d.ts']
    let config = JSON.parse(sources['wrangler.json'])
    config.vars = { ROOM_PAGE: '/index.html' }
    files['wrangler.json'] = JSON.stringify(config, null, 2) + '\n'
  }
  if (view === 'voxel') files['trees.ts'] = sources['voxel-trees.ts']
  let manifest = JSON.parse(sources['package.json'])
  let depends = manifest.dependencies as Record<string, string>
  if (view !== 'voxel') delete depends['@yaks/voxel']
  if (!dimensional) {
    delete depends.three
    delete depends['@yaks/stage']
  }
  if (multiplayer || !dimensional) delete depends['@yaks/ui']
  if (!multiplayer) {
    delete depends['@yaks/workerd']
    delete depends['@yaks/graph']
  }
  files['package.json'] = JSON.stringify(manifest, null, 2) + '\n'
  return Object.entries(files).map((
    [path, content],
  ) => (path.endsWith('.png') ? { path, base64: content } : { path, content }))
}
