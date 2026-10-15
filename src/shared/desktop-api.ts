import type { Composition } from './composition'

export type FileResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

/** Only these capabilities cross the isolated renderer/preload boundary. */
export interface DesktopApi {
  openScore(): Promise<FileResult<{ score: Composition; fileName: string }>>
  saveScore(score: Composition): Promise<FileResult<{ fileName: string }>>
  setDocumentDirty(dirty: boolean): void
}
