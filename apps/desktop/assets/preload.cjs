const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  activate: () => ipcRenderer.invoke('desktop-activate'),
  onStatus: callback => ipcRenderer.on('desktop-status', (_event, status) => callback(status)),
})
