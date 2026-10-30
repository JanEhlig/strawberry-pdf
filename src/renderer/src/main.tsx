import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next'
import './styles/tokens.css'
import './styles/base.css'
import type { SavedSignature } from '@shared/api'
import { App } from './app/App'
import { engine } from './engine/client'
import { platform } from './platform'
import { t } from './i18n'
import { toast, useApp } from './state/appStore'
import { openPaths } from './state/files'
import { loadSettings } from './state/settings'

async function boot(): Promise<void> {
  const env = await platform.environment()
  useApp.setState({ env })
  await loadSettings()
  const [signatures, recent] = await Promise.all([platform.loadStore<SavedSignature[]>('signatures'), platform.getRecent()])
  useApp.setState({ signatures: signatures ?? [], recent })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )

  engine().onCrash(() => toast(t('error.engineCrashed'), 'error', undefined, 3_600_000))
  try {
    await engine().ready()
  } catch {
    return
  }
  platform.onOpenFiles((paths) => void openPaths(paths))
  const initial = await platform.takeInitialFiles()
  if (initial.length > 0) await openPaths(initial)
}

void boot()
