/** Node loader for a unit database built by scripts/speech/corpus/build-units.py. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UnitDatabase } from '../../src/speech/backends/units'

export function loadNodeUnits(dir: string): UnitDatabase {
  const meta = JSON.parse(readFileSync(join(dir, 'units.json'), 'utf8')) as Omit<UnitDatabase, 'pcm'>
  const bin = readFileSync(join(dir, 'units.bin'))
  const pcm = new Int16Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength))
  return { ...meta, pcm }
}
