import { binaryCases, binaryVocab } from '../sqlite/binary_cases.ts'
import { ram } from './mod.ts'

binaryCases(() => ram(binaryVocab))
