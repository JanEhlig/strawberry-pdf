import {
  Combine,
  Ellipsis,
  FileDown,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Highlighter,
  Info,
  Keyboard,
  LayoutGrid,
  Moon,
  MousePointer2,
  PanelLeft,
  PenLine,
  Printer,
  Redo2,
  Save,
  Search,
  Settings,
  Shapes,
  Signature,
  SquareX,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import { useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import { opLabel, t, type MessageKey } from '@renderer/i18n'
import { openAbout } from '@renderer/dialogs/AboutDialog'
import { openProperties } from '@renderer/dialogs/PropertiesDialog'
import { openSettings } from '@renderer/dialogs/SettingsDialog'
import { openShortcuts } from '@renderer/dialogs/ShortcutsDialog'
import { setTool, useApp, type TabEntry } from '@renderer/state/appStore'
import { exportTab } from '@renderer/state/export'
import { combineFiles, promptOpen, saveTab } from '@renderer/state/files'
import { PageTray } from '@renderer/organize/PageTray'
import { printTab } from '@renderer/state/print'
import { rgbToCss, type ToolId, type ToolSettings } from '@renderer/tools/tools'
import { Button, IconButton, MenuItem, MenuSeparator, Popover } from '@renderer/ui'

interface ToolDef {
  id: ToolId
  icon: LucideIcon
  label: MessageKey
  hint: MessageKey
  cap?: (s: ToolSettings) => string
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: MousePointer2, label: 'tool.select', hint: 'tool.select.hint' },
  { id: 'markup', icon: Highlighter, label: 'tool.markup', hint: 'tool.markup.hint', cap: (s) => rgbToCss(s.markup.color) },
  { id: 'text', icon: Type, label: 'tool.text', hint: 'tool.text.hint', cap: (s) => rgbToCss(s.text.color) },
  { id: 'draw', icon: PenLine, label: 'tool.draw', hint: 'tool.draw.hint', cap: (s) => rgbToCss(s.draw.color) },
  { id: 'shapes', icon: Shapes, label: 'tool.shapes', hint: 'tool.shapes.hint', cap: (s) => rgbToCss(s.shapes.color) },
  { id: 'note', icon: StickyNote, label: 'tool.note', hint: 'tool.note.hint', cap: (s) => rgbToCss(s.note.color) },
  { id: 'sign', icon: Signature, label: 'tool.sign', hint: 'tool.sign.hint', cap: () => 'var(--accent)' },
  { id: 'redact', icon: SquareX, label: 'tool.redact', hint: 'tool.redact.hint', cap: () => 'var(--danger)' }
]

function useOrganizing(tab: TabEntry | null): boolean {
  return useSyncExternalStore(
    (notify) => (tab ? tab.store.subscribe(notify) : () => undefined),
    () => (tab ? tab.store.getState().organize : false)
  )
}

function ToolTray({ tab }: { tab: TabEntry | null }): React.JSX.Element {
  const tool = useApp((s) => s.tool)
  const settings = useApp((s) => s.toolSettings)
  const disabled = !tab
  return (
    <div className="tool-tray" role="toolbar" aria-label={t('toolbar.tools')}>
      {TOOLS.map((def) => {
        const Icon = def.icon
        const active = tool === def.id
        return (
          <button
            key={def.id}
            type="button"
            className={`tool${active ? ' active' : ''}`}
            aria-pressed={active}
            aria-label={t(def.label)}
            data-tip={t(def.hint)}
            disabled={disabled}
            onClick={() => setTool(def.id)}
          >
            <span className="tool-icon">
              <Icon size={19} strokeWidth={1.9} />
              {def.cap && <span className="tool-cap" style={{ background: def.cap(settings) }} />}
            </span>
            <span className="tool-label">{t(def.label)}</span>
          </button>
        )
      })}
      <span className="tray-sep" />
      <button
        type="button"
        className="tool plain"
        aria-label={t('tool.pages')}
        data-tip={t('tool.pages.hint')}
        disabled={disabled}
        onClick={() => tab?.store.getState().setOrganize(true)}
      >
        <span className="tool-icon">
          <LayoutGrid size={19} strokeWidth={1.9} />
        </span>
        <span className="tool-label">{t('tool.pages')}</span>
      </button>
    </div>
  )
}

function HistoryButtons({ tab }: { tab: TabEntry }): React.JSX.Element {
  const history = useStore(tab.store, (s) => s.history)
  const undo = opLabel(history.undoLabel)
  const redo = opLabel(history.redoLabel)
  return (
    <>
      <IconButton
        label={undo ? t('action.undoOp', { op: undo }) : t('action.undo')}
        disabled={!history.canUndo}
        onClick={() => void tab.store.getState().undo()}
      >
        <Undo2 size={18} />
      </IconButton>
      <IconButton
        label={redo ? t('action.redoOp', { op: redo }) : t('action.redo')}
        disabled={!history.canRedo}
        onClick={() => void tab.store.getState().redo()}
      >
        <Redo2 size={18} />
      </IconButton>
    </>
  )
}

function SaveButton({ tab }: { tab: TabEntry }): React.JSX.Element {
  const dirty = useStore(tab.store, (s) => s.history.dirty)
  return (
    <Button variant={dirty ? 'primary' : 'ghost'} data-tip={t('action.save')} onClick={() => void saveTab(tab, 'save')}>
      <Save size={17} />
      <span className="hide-narrow">{t('common.save')}</span>
    </Button>
  )
}

function MoreMenu({ tab }: { tab: TabEntry | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const darkPages = useApp((s) => s.darkPages)
  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <>
      <IconButton ref={anchor} label={t('action.menu')} pressed={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={19} />
      </IconButton>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} placement="bottom-end" label={t('action.menu')}>
          <div role="menu" className="menu">
            <MenuItem icon={<FolderOpen size={17} />} hint={`${t('key.ctrl')}+O`} onClick={run(() => void promptOpen())}>
              {t('menu.open')}
            </MenuItem>
            <MenuItem icon={<Combine size={17} />} onClick={run(() => void combineFiles())}>
              {t('menu.combine')}
            </MenuItem>
            <MenuItem icon={<Save size={17} />} hint={`${t('key.ctrl')}+S`} disabled={!tab} onClick={run(() => tab && void saveTab(tab, 'save'))}>
              {t('menu.save')}
            </MenuItem>
            <MenuItem icon={<Save size={17} />} hint={`${t('key.ctrl')}+${t('key.shift')}+S`} disabled={!tab} onClick={run(() => tab && void saveTab(tab, 'saveAs'))}>
              {t('menu.saveAs')}
            </MenuItem>
            <MenuItem icon={<FileDown size={17} />} disabled={!tab} onClick={run(() => tab && void saveTab(tab, 'flatten'))}>
              {t('menu.saveFlat')}
            </MenuItem>
            <MenuItem icon={<FileText size={17} />} disabled={!tab} onClick={run(() => tab && void exportTab(tab, 'docx'))}>
              {t('menu.exportWord')}
            </MenuItem>
            <MenuItem icon={<FileSpreadsheet size={17} />} disabled={!tab} onClick={run(() => tab && void exportTab(tab, 'xlsx'))}>
              {t('menu.exportExcel')}
            </MenuItem>
            <MenuItem icon={<Printer size={17} />} hint={`${t('key.ctrl')}+P`} disabled={!tab} onClick={run(() => tab && void printTab(tab))}>
              {t('menu.print')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Moon size={17} />}
              role="menuitemcheckbox"
              aria-checked={darkPages}
              hint={darkPages ? '✓' : undefined}
              disabled={!tab}
              onClick={run(() => useApp.setState({ darkPages: !darkPages }))}
            >
              {t('menu.darkPages')}
            </MenuItem>
            <MenuItem icon={<Info size={17} />} disabled={!tab} onClick={run(() => tab && openProperties(tab))}>
              {t('menu.properties')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Settings size={17} />} onClick={run(openSettings)}>
              {t('menu.settings')}
            </MenuItem>
            <MenuItem icon={<Keyboard size={17} />} hint="F1" onClick={run(openShortcuts)}>
              {t('menu.shortcuts')}
            </MenuItem>
            <MenuItem icon={<Info size={17} />} onClick={run(openAbout)}>
              {t('menu.about')}
            </MenuItem>
          </div>
        </Popover>
      )}
    </>
  )
}

function SearchToggle({ tab }: { tab: TabEntry | null }): React.JSX.Element {
  if (!tab) {
    return (
      <IconButton label={t('action.search')} disabled>
        <Search size={19} />
      </IconButton>
    )
  }
  return <ActiveSearchToggle tab={tab} />
}

function ActiveSearchToggle({ tab }: { tab: TabEntry }): React.JSX.Element {
  const open = useStore(tab.store, (s) => s.search.open)
  return (
    <IconButton
      label={t('action.search')}
      pressed={open}
      onClick={() => {
        const s = tab.store.getState()
        s.setOrganize(false)
        s.setSearch({ open: !open })
      }}
    >
      <Search size={19} />
    </IconButton>
  )
}

export function Toolbar({ tab }: { tab: TabEntry | null }): React.JSX.Element {
  const sidebar = useApp((s) => s.sidebar)
  const organizing = useOrganizing(tab)
  return (
    <div className="toolbar">
      <div className="toolbar-side">
        <IconButton
          label={t('action.sidebar')}
          pressed={sidebar !== null && !organizing}
          disabled={!tab || organizing}
          onClick={() => useApp.setState({ sidebar: sidebar ? null : 'pages' })}
        >
          <PanelLeft size={19} />
        </IconButton>
        <span className="toolbar-sep" />
        {tab && <HistoryButtons tab={tab} />}
      </div>
      {tab && organizing ? <PageTray tab={tab} /> : <ToolTray tab={tab} />}
      <div className="toolbar-side end">
        <SearchToggle tab={tab} />
        {tab && <SaveButton tab={tab} />}
        <MoreMenu tab={tab} />
      </div>
    </div>
  )
}
