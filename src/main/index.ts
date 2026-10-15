import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseComposition } from '../shared/composition'
import type { FileResult } from '../shared/desktop-api'
import { readScoreFile, writeScoreFile } from './score-files'

const directory = fileURLToPath(new URL('.', import.meta.url))
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const pageUrl = new URL(developmentUrl ?? new URL('../renderer/index.html', import.meta.url)).href
let window: BrowserWindow | null = null
let dirty = false
let closing = false

function trusted(sender: Electron.WebContents, frame: Electron.WebFrameMain | null): boolean {
  return window !== null && sender === window.webContents && frame === sender.mainFrame
    && frame.url === pageUrl
}

function errorResult(error: unknown): FileResult<never> {
  console.error('Score operation failed:', error instanceof Error ? error.message : 'Unknown error')
  return { status: 'error', message: error instanceof Error ? error.message : 'Unable to access the score file.' }
}

function createWindow(): void {
  dirty = false
  closing = false
  window = new BrowserWindow({
    width: 1380, height: 940, minWidth: 900, minHeight: 650,
    title: 'Notation', backgroundColor: '#f2f4f7', autoHideMenuBar: true,
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('close', (event) => {
    if (!dirty || closing || !window) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', title: 'Unsaved composition',
      message: 'Close without saving your composition?',
      buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0,
    })
    if (choice === 1) { closing = true; window.close() }
  })
  window.on('closed', () => { window = null })
  void window.loadURL(pageUrl)
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  ipcMain.on('score:dirty', (event, value: unknown) => {
    if (trusted(event.sender, event.senderFrame) && typeof value === 'boolean') dirty = value
  })
  ipcMain.handle('score:open', async (event) => {
    if (!trusted(event.sender, event.senderFrame) || !window) return { status: 'error', message: 'Unauthorized request.' }
    try {
      const result = await dialog.showOpenDialog(window, {
        title: 'Open composition', properties: ['openFile'],
        filters: [{ name: 'Notation score', extensions: ['notation'] }],
      })
      if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' }
      const path = result.filePaths[0]
      return { status: 'ok', value: { score: await readScoreFile(path), fileName: basename(path) } }
    } catch (error) { return errorResult(error) }
  })
  ipcMain.handle('score:save', async (event, input: unknown) => {
    if (!trusted(event.sender, event.senderFrame) || !window) return { status: 'error', message: 'Unauthorized request.' }
    try {
      const score = parseComposition(input)
      const result = await dialog.showSaveDialog(window, {
        title: 'Save composition', defaultPath: `${score.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.notation`,
        filters: [{ name: 'Notation score', extensions: ['notation'] }],
      })
      if (result.canceled || !result.filePath) return { status: 'cancelled' }
      await writeScoreFile(result.filePath, score)
      return { status: 'ok', value: { fileName: basename(result.filePath) } }
    } catch (error) { return errorResult(error) }
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
