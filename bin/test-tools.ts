// External tools whose build changes a test's time, pinned like the SQLite
// library (./sqlite.ts). The box's Homebrew rclone took 46–55 ms to start;
// the gate's Ubuntu build took 19–24 ms. A backup starts it several times,
// so the same code failed its record only on the box. Selected tests get
// the same package, cached by its digest, at the front of their PATH.

type Tool = { url: string; sha256: string; path: string; files: string[] }

let TOOLS: Tool[] = Deno.build.os == 'linux' && Deno.build.arch == 'x86_64'
  ? [{
    url:
      'https://archive.ubuntu.com/ubuntu/pool/universe/r/rclone/rclone_1.60.1+dfsg-4ubuntu3.2_amd64.deb',
    sha256: '37124f897112c536e4057cc3e4c68b7bcb8dadb88e415c959d900c7ff0378bee',
    path: 'usr/bin/rclone',
    files: ['bin/backup_test.ts'],
  }]
  : []

let exists = (path: string) => Deno.stat(path).then(() => true, () => false)
let hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')

// Extract a verified package beside its destination, then rename it into
// place: another run finds the whole package.
let install = async (tool: Tool, cache: string) => {
  let dir = `${cache}/yak/test-tools/${tool.sha256}`
  let binary = `${dir}/${tool.path}`
  if (!await exists(binary)) {
    await Deno.mkdir(`${cache}/yak/test-tools`, { recursive: true })
    let work = await Deno.makeTempDir({ dir: `${cache}/yak/test-tools` })
    try {
      let got = await fetch(tool.url)
      if (!got.ok) throw Error(`${tool.url}: ${got.status}`)
      let bytes = new Uint8Array(await got.arrayBuffer())
      if (await hex(bytes) != tool.sha256) {
        throw Error(`${tool.url}: sha256 differs`)
      }
      await Deno.writeFile(`${work}/tool.deb`, bytes)
      let out = await new Deno.Command('dpkg-deb', {
        args: ['-x', `${work}/tool.deb`, `${work}/tree`],
        stdout: 'null',
        stderr: 'piped',
      }).output()
      if (!out.success) throw Error(new TextDecoder().decode(out.stderr))
      await Deno.rename(`${work}/tree`, dir).catch(async (error) => {
        if (!await exists(binary)) throw error
      })
    } finally {
      await Deno.remove(work, { recursive: true })
    }
  }
  return binary.slice(0, binary.lastIndexOf('/'))
}

/** Directories of the pinned tools the selected test files use. */
export let tools = async (
  files: string[],
  cache = Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`,
): Promise<string[]> =>
  await Promise.all(
    TOOLS.filter((tool) => tool.files.some((file) => files.includes(file)))
      .map((tool) => install(tool, cache)),
  )
