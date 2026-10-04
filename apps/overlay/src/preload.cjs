// @ts-check
// Tiny bridge for apps/web/src/overlay: click-through toggling and opening https links in the browser.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fetchOverlay', {
  /** on = the window takes mouse input (cursor over the pet / overlay UI). focus: true takes keyboard focus (text box), false gives it up. */
  setInteractive: (/** @type {boolean} */ on, /** @type {boolean | undefined} */ focus) =>
    ipcRenderer.send('overlay:interactive', !!on, typeof focus === 'boolean' ? focus : null),
  /** Opens an https URL in the default browser (e.g. a "connect this app" link). Non-https is ignored by main. */
  openExternal: (/** @type {string} */ url) => ipcRenderer.send('overlay:open-external', String(url)),
});
