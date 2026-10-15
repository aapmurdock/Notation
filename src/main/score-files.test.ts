// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExample } from '../shared/composition'
import { MAX_SCORE_BYTES, readScoreFile, writeScoreFile } from './score-files'

describe('native score persistence', () => {
  let directory: string
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'notation-files-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('saves, reopens, and replaces a score without leaving temporary files', async () => {
    const path = join(directory, 'My score.notation')
    const score = createExample()
    await writeScoreFile(path, score)
    expect(await readScoreFile(path)).toEqual(score)
    score.title = 'A revised title'
    await writeScoreFile(path, score)
    expect((await readScoreFile(path)).title).toBe('A revised title')
    expect(await readdir(directory)).toEqual(['My score.notation'])
  })
  it('preserves an existing file if the replacement score is invalid', async () => {
    const path = join(directory, 'score.notation')
    await writeScoreFile(path, createExample())
    const original = await readFile(path, 'utf8')
    await expect(writeScoreFile(path, { ...createExample(), tempoBpm: -1 })).rejects.toThrow(/Tempo/)
    expect(await readFile(path, 'utf8')).toBe(original)
  })
  it('rejects corrupt JSON, unsupported versions, and oversized files', async () => {
    const path = join(directory, 'bad.notation')
    await writeFile(path, '{broken')
    await expect(readScoreFile(path)).rejects.toThrow()
    await writeFile(path, JSON.stringify({ schemaVersion: 99 }))
    await expect(readScoreFile(path)).rejects.toThrow(/version/)
    await writeFile(path, ' '.repeat(MAX_SCORE_BYTES + 1))
    await expect(readScoreFile(path)).rejects.toThrow(/2 MB/)
  })
})
