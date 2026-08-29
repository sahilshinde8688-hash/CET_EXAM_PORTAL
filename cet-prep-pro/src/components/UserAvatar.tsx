import type { AuthUser } from '../lib/api'

interface UserAvatarProps {
  user?: Pick<AuthUser, 'name'> | null
  className: string
  onClick?: () => void
}

export default function UserAvatar({ user, className, onClick }: UserAvatarProps) {
  const name = user?.name?.trim() || 'Student'
  const initials = name
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <button
      type="button"
      className={`${className} user-avatar-button`}
      onClick={onClick}
      aria-label="Open account settings"
      title="Account settings"
    >
      {initials}
    </button>
  )
}