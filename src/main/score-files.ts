import { open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { parseComposition, serializeComposition, type Composition } from '../shared/composition'

export const MAX_SCORE_BYTES = 2 * 1024 * 1024

export async function readScoreFile(path: string): Promise<Composition> {
  const file = await open(path, 'r')
  try {
    if ((await file.stat()).size > MAX_SCORE_BYTES) throw new Error('Score files must be smaller than 2 MB.')
    return parseComposition(JSON.parse(await file.readFile('utf8')))
  } finally {
    await file.close()
  }
}

/** Write beside the destination and rename, so a failed write preserves the previous file. */
export async function writeScoreFile(path: string, score: Composition): Promise<void> {
  const contents = serializeComposition(score)
  if (Buffer.byteLength(contents) > MAX_SCORE_BYTES) throw new Error('Score files must be smaller than 2 MB.')
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(contents, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
