// The one-time Vale release repackage: select only deploys whose sound files
// have the audited legacy hashes, and keep their complete prior manifests.

export type Files = Record<string, string>
export type Version = {
  eid: string
  app: string
  version: number
  source: string
  files: Files
}

export type Repack = {
  version: Version
  files: Files
  changed: string[]
}

export let LEGACY: Files = {
  'data/sfx/01.json':
    'de1df5eb536372584346a36d2dcc4ceba9252cf3c2f2dd55d30027d40b3e39ab',
  'data/sfx/02.json':
    '86099cf3c4eac02fad5a4db20c8932a37aa56747dbbc84d8a598eee575cc2f1d',
  'data/sfx/03.json':
    '91d31b40aace84660f758d6f8e9332693a6145b769d2340ff4d8d8d160e813b4',
  'data/sfx/04.json':
    '1a0450e93a929af75b8bc0334156a2e7dc5b301c83c3a8e19ae730e535475b0e',
  'data/sfx/05.json':
    'd37c0d12feb727ca57ab1f9e349659fd52f6885e5cfe8de8f8f1d05608dc6cf0',
  'data/sfx/06.json':
    '6d54753990f0d88108794564e1ae30d9043077ae1933e9afa7a8bc5b1809395e',
  'data/sfx/07.json':
    'bd6072c48877505cb7adff7f321e60ef4f53f57b901252917b307000b854f1c5',
  'data/sfx/08.json':
    'f2b1113420ebfd2f7582308c3b93bc0f0787b57b07e4e53cc09fc1c8054553ef',
  'data/sfx/09.json':
    '5f627075482a27e3022dcf5a21ff97f96fdb6ad102c957b0228360c606f786bd',
}

let OLD_DESCRIPTION =
  'The description of one sound Vale needs. Its own builder reads this row and cites it in the generated recording.'
let NEW_DESCRIPTION =
  'The description of one sound Vale needs. The shared sound builder reads this row and cites it in the generated recording.'

/** Change only the sound wording in each version's own vocabulary. */
export let soundVocab = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  let doc = JSON.parse(new TextDecoder().decode(bytes))
  let sfx = doc?.$defs?.sfx
  if (sfx?.description != OLD_DESCRIPTION) {
    throw new Error('release vocabulary has an unfamiliar sfx description')
  }
  sfx.description = NEW_DESCRIPTION
  return new TextEncoder().encode(JSON.stringify(doc))
}

let required = [
  ...Object.keys(LEGACY),
  'data/sfx/README.md',
  'samples.ts',
  'samples_test.ts',
  'vocab.json',
]

/** A manifest backup plus the revised file set for each affected deploy. */
export let repackage = (
  versions: Version[],
  replacements: Files,
  vocabs: Record<string, string>,
): Repack[] => {
  let names = Object.keys(replacements)
  if (
    required.filter((path) => path != 'vocab.json').some((path) =>
      !names.includes(path)
    ) ||
    names.some((path) => !required.includes(path)) ||
    names.includes('vocab.json') ||
    names.some((path) => !/^[0-9a-f]{64}$/.test(replacements[path])) ||
    Object.values(vocabs).some((sha) => !/^[0-9a-f]{64}$/.test(sha))
  ) throw new Error('replacement file set is incomplete')
  return versions.flatMap((version) => {
    let old = Object.entries(LEGACY).filter(([path, sha]) =>
      version.files[path] == sha
    )
    if (!old.length) return []
    if (
      old.length != Object.keys(LEGACY).length ||
      required.some((path) => !(path in version.files)) ||
      !vocabs[version.files['vocab.json']] ||
      (version.source &&
        !/^[-\w]+\/\.releases\/[^/]+\/[^/]+$/.test(version.source))
    ) {
      throw new Error(
        `partial legacy release v${version.version} ${version.app}`,
      )
    }
    let files: Files = {
      ...version.files,
      ...replacements,
      'vocab.json': vocabs[version.files['vocab.json']],
    }
    return [{
      version: { ...version, files: { ...version.files } },
      files,
      changed: [...names, 'vocab.json'].filter((path) =>
        files[path] != version.files[path]
      ),
    }]
  })
}
