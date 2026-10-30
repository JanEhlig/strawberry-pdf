const { app } = require('electron')

app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

app.on('browser-window-created', (_event, win) => {
  win.setSkipTaskbar(true)
  win.setPosition(-30000, -30000)
  win.show = () => win.showInactive()
  win.focus = () => undefined
})
