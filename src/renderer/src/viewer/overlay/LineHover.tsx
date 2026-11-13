import { PencilLine } from 'lucide-react'
import type { TextLine } from '@renderer/engine/types'
import { t } from '@renderer/i18n'

const PAD = 2

export function LineHover({ line, scale }: { line: TextLine; scale: number }): React.JSX.Element {
  const [x0, y0, x1, y1] = line.bbox
  return (
    <div
      className="line-hover"
      style={{ left: x0 * scale - PAD, top: y0 * scale - PAD, width: (x1 - x0) * scale + PAD * 2, height: (y1 - y0) * scale + PAD * 2 }}
    >
      <span className="line-hover-tag">
        <PencilLine size={12} aria-hidden="true" />
        {t('selection.editText')}
      </span>
    </div>
  )
}
