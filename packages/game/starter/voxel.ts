import { play } from './play.ts'
import { field, traveler } from './world.ts'
import { tree } from './voxel-trees.ts'

await play(field(tree), traveler())
