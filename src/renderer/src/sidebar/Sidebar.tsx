import { ChevronRight, Highlighter, MessageSquare, PenLine, Shapes, Signature, SquareX, StickyNote, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { AnnotData, OutlineNode } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { useApp, type SidebarTab, type TabEntry } from '@renderer/state/appStore'
import { Segmented } from '@renderer/ui'
import { annotLabel, formatDate, opensComment } from '@renderer/viewer/overlay/CommentPopover'
import { Thumbnails } from './Thumbnails'
import './sidebar.css'

function OutlineItem({ tab, node, depth }: { tab: TabEntry; node: OutlineNode; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(node.open)
  const hasChildren = node.children.length > 0
  return (
    <li>
      <div className="outline-row" style={{ paddingLeft: 6 + depth * 14 }}>
        {hasChildren ? (
          <button type="button" className={`outline-toggle${open ? ' open' : ''}`} aria-expanded={open} aria-label={node.title} onClick={() => setOpen(!open)}>
            <ChevronRight size={14} />
          </button>
        ) : (
          <span className="outline-toggle-spacer" />
        )}
        <button
          type="button"
          className="outline-title"
          disabled={node.page === null}
          onClick={() => node.page !== null && tab.store.getState().goTo(node.page)}
        >
          {node.title || '—'}
        </button>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((child, i) => (
            <OutlineItem key={i} tab={tab} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Outline({ tab }: { tab: TabEntry }): React.JSX.Element {
  const outline = useStore(tab.store, (s) => s.info.outline)
  if (outline.length === 0) return <p className="sidebar-empty">{t('sidebar.outlineEmpty')}</p>
  return (
    <ul className="outline" role="tree">
      {outline.map((node, i) => (
        <OutlineItem key={i} tab={tab} node={node} depth={0} />
      ))}
    </ul>
  )
}

function KindIcon({ annot }: { annot: AnnotData }): React.JSX.Element {
  const size = 15
  if (annot.role === 'signature') return <Signature size={size} />
  switch (annot.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
      return <Highlighter size={size} />
    case 'freetext':
      return <Type size={size} />
    case 'ink':
      return <PenLine size={size} />
    case 'square':
    case 'circle':
    case 'line':
    case 'polygon':
    case 'polyline':
      return <Shapes size={size} />
    case 'note':
      return <StickyNote size={size} />
    case 'redact':
      return <SquareX size={size} />
    default:
      return <MessageSquare size={size} />
  }
}

function Comments({ tab }: { tab: TabEntry }): React.JSX.Element {
  const list = useStore(tab.store, (s) => s.allAnnots)
  const stamp = useStore(tab.store, (s) => s.allAnnotsStamp)
  const selection = useStore(tab.store, (s) => s.selection)
  useEffect(() => {
    void tab.store.getState().loadAllAnnotations()
  }, [tab, stamp])
  if (!list) return <p className="sidebar-empty">{t('sidebar.commentsLoading')}</p>
  if (list.length === 0) return <p className="sidebar-empty">{t('sidebar.commentsEmpty')}</p>
  let lastPage = -1
  return (
    <ul className="comments">
      {list.map((annot) => {
        const header = annot.page !== lastPage
        lastPage = annot.page
        const active = selection?.id === annot.id
        return (
          <li key={annot.id}>
            {header && <div className="comments-page">{t('sidebar.page', { n: annot.page + 1 })}</div>}
            <button
              type="button"
              className={`comment-item${active ? ' active' : ''}`}
              onClick={() => {
                const s = tab.store.getState()
                useApp.setState({ tool: 'select' })
                s.goTo(annot.page, { y: annot.bounds[1], ifNeeded: true })
                s.select({ page: annot.page, id: annot.id })
                if (opensComment(annot)) s.setEditing({ kind: 'comment', page: annot.page, id: annot.id })
              }}
              onDoubleClick={() => {
                tab.store.getState().setEditing({ kind: 'comment', page: annot.page, id: annot.id })
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.comment-popover textarea')?.focus())
              }}
            >
              <span className="comment-icon" style={{ color: annot.kind === 'redact' ? 'var(--danger)' : undefined }}>
                <KindIcon annot={annot} />
              </span>
              <span className="comment-body">
                <span className="comment-title">{annotLabel(annot)}</span>
                {annot.contents && <span className="comment-preview">{annot.contents}</span>}
                <span className="comment-sub">
                  {annot.author}
                  {annot.author && annot.modified ? ', ' : ''}
                  {formatDate(annot.modified)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function Sidebar({ tab }: { tab: TabEntry }): React.JSX.Element {
  const view = useApp((s) => s.sidebar) ?? 'pages'
  return (
    <aside className="sidebar" aria-label={t('action.sidebar')}>
      <div className="sidebar-head">
        <Segmented<SidebarTab>
          label={t('action.sidebar')}
          value={view}
          onChange={(v) => useApp.setState({ sidebar: v })}
          options={[
            { id: 'pages', label: t('sidebar.pages') },
            { id: 'outline', label: t('sidebar.outline') },
            { id: 'comments', label: t('sidebar.comments') }
          ]}
          compact
        />
      </div>
      <div className="sidebar-body">
        {view === 'pages' && <Thumbnails key={tab.id} tab={tab} />}
        {view === 'outline' && <Outline tab={tab} />}
        {view === 'comments' && <Comments tab={tab} />}
      </div>
    </aside>
  )
}
