import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}

export function TagChip({ children, active, onClick }: Props) {
  if (!onClick) return <span className="tag-chip">{children}</span>
  return (
    <button
      type="button"
      className={`tag-chip ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
