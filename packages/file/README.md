# @yaks/file

Files as entities. A **file** is a path read in a **root**, and anything in the
graph refers to it by its eid instead of repeating the path. A **place** in a
file is the lines an entity sits at. A **look** at a volume says how full it is
and what fills it, one a day.

## Components

| component   | properties                                                        | what it is                                                                 |
| ----------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `file`      | `path`, `root`                                                    | a path in a root; its eid is derived from both (`fileOf`)                  |
| `lines`     | `file`, `start`, `end`                                            | where in a file the entity sits, lines `start` through `end` (absent: one) |
| `volume`    | `machine`, `mount`                                                | a filesystem as a machine mounts it; its eid is derived from both          |
| `occupancy` | `volume`, `day`, `at`, `size`, `used`, `free`, `counted`, `paths` | a volume's latest look on a UTC day; its eid is derived from both          |

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

## What fills a disk

A host that lists `@yaks/file` among its plugins runs its duty
(`@yaks/file/service`) for the computer it is on. Every hour it reads the
computer's disks (`df`: each local disk filesystem once, leaving out those in
memory, the kernel's and network mounts), and walks each one whose day has no
look yet, or whose latest look is an hour old (`du -x`, at the lowest CPU and
disk priority). The walk lists every directory and file holding at least a
thousandth of the volume, so a directory listed holds everything listed under
it, and the day's `occupancy` row keeps it beside the filesystem's size, used
and free bytes. A later look that day replaces the earlier, so a run of days is
the trend. A walk of this box's 140 GB takes half a minute once the kernel has
cached its directories, and sixteen minutes the first time after a boot.

```ts
import { lines, walked } from '@yaks/file/occupancy'
import { equal } from '@yaks/testing'

let found: [number, string][] = [
  [300, '/home/me/yak.db'],
  [700, '/home/me'],
  [900, '/home'],
  [1000, '/'],
]
let walk = walked(found, '/', new Set(['/home/me', '/home', '/']))
equal(walk, {
  counted: 1000,
  paths: { 'home/me/yak.db': 300, 'home/me/': 700, 'home/': 900 },
})
// The tree with `home/` open: what it lists, then what is too small to list.
equal(lines(walk, (path) => path == 'home/').map((l) => [l.path, l.bytes]), [
  ['home/', 900],
  ['home/me/', 700],
  ['home/', 200],
  ['', 100],
])
```

The browsing app draws them (`@yaks/file/views`): the Disks page in the sidebar,
and the Disks tab a machine or a volume opens on. Each volume shows how full it
is and how fast that changes, what fills it as a tree whose directories holding
a tenth of what is used start open, each path's change since a week before, its
largest files and day by day. The file the graph keeps its pages in says how
many of them are free, from @yaks/journal's `kept{file, free}`. The page reads
only the rows; opening it measures nothing.
