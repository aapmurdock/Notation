import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'

const api: DesktopApi = {
  openScore: () => ipcRenderer.invoke('score:open'),
  saveScore: (score) => ipcRenderer.invoke('score:save', score),
  setDocumentDirty: (dirty) => ipcRenderer.send('score:dirty', dirty),
}

contextBridge.exposeInMainWorld('notation', api)
