const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('app:getState'),
  addTask: (payload) => ipcRenderer.invoke('tasks:add', payload),
  updateTask: (payload) => ipcRenderer.invoke('tasks:update', payload),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  runNow: (id) => ipcRenderer.invoke('tasks:runNow', id),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  testAi: (patch) => ipcRenderer.invoke('ai:test', patch),
  openWorkspace: () => ipcRenderer.invoke('shell:openWorkspace'),
  clearMemory: () => ipcRenderer.invoke('memory:clear'),
  deleteMemory: (id) => ipcRenderer.invoke('memory:delete', id),
  onState: (cb) => { ipcRenderer.on('state:update', (e, s) => cb(s)); }
});
