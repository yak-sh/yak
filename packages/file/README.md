# @yaks/file

Files as entities. A **file** is a path read in a **root**, and anything in the
graph refers to it by its eid instead of repeating the path. A **place** in a
file is the lines an entity sits at.

## Components

| component | properties             | what it is                                                                 |
| --------- | ---------------------- | -------------------------------------------------------------------------- |
| `file`    | `path`, `root`         | a path in a root; its eid is derived from both (`fileOf`)                  |
| `lines`   | `file`, `start`, `end` | where in a file the entity sits, lines `start` through `end` (absent: one) |
| `volume`  | `machine`, `mount`     | a filesystem as a machine mounts it; its eid is derived from both          |

A root is any entity paths are read in. Two kinds hold files today:

- a **repository** (@yaks/git): its files are abstract, a path in its tree at
  any commit, on no disk. The path is as Git spells it.
- a **volume**: its files are bytes on a disk. The path is from its mount, so
  `/home/me/notes.md` on a machine's root volume is the path `home/me/notes.md`.

A file carries its contents as `content{body}` where the graph keeps them (the
skill mirror keeps a skill's support files this way) and goes without where the
bytes are elsewhere (a transcript on disk).

A place is `lines` on the entity that sits there. An entry read from line 812 of
a transcript wears `lines{file, start: 812}`. A citation of lines 10 to 20 is a
`cites` edge (@yaks/git) to an entity wearing `lines{file, start, end}` with
those numbers, holding the text it quoted as `content{body}`.

## Placing a path

```ts
import { fileOf, joined, placed, volumeOf } from '@yaks/file'
import { assertEquals } from '@std/assert'

let at = placed(['/', '/mnt/data'], '/mnt/data/photos/cat.jpg')
assertEquals(at, { mount: '/mnt/data', path: 'photos/cat.jpg' })
assertEquals(joined(at!.mount, at!.path), '/mnt/data/photos/cat.jpg')

let volume = volumeOf('machine-eid', '/mnt/data')
assertEquals(fileOf(volume, 'photos/cat.jpg'), fileOf(volume, 'photos/cat.jpg'))
```

A machine's volumes are rows. A path sits on the one with the longest mount that
contains it, and a machine's root volume (`/`) is written the first time a path
needs it. A volume's identity is where its machine mounts it, so the same disk
mounted by another machine is another volume there.

## This computer

`@yaks/file/local` holds the effects: `here(g)` is this computer, the machine
addressed `local://` (written the first time a graph asks), and
`onDisk(g, absolute)` is the bundle that makes a path on it a file. Both read
the graph once per graph; a volume written later is seen by processes started
after it.
