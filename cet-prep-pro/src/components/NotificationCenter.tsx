import { useCallback, useEffect, useRef, useState } from 'react'
import {
  notificationsAPI,
  type StudentNotification,
} from '../lib/api'
import './notification-center.css'

interface NotificationCenterProps {
  onOpenNotification: (notification: StudentNotification) => void
}

const PAGE_SIZE = 20

const categoryLabels: Record<StudentNotification['category'], string> = {
  exam_update: 'Exam Updates',
  test_assignment: 'Test Assignments',
  result: 'Results',
  reminder: 'Reminders',
  system_alert: 'System Alerts',
}

const categoryIcons: Record<StudentNotification['category'], string> = {
  exam_update: 'event_available',
  test_assignment: 'assignment',
  result: 'workspace_premium',
  reminder: 'schedule',
  system_alert: 'campaign',
}

const dateAndTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export default function NotificationCenter({ onOpenNotification }: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<StudentNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelOpenRef = useRef(open)
  const visibleNotificationCountRef = useRef(notifications.length)
  panelOpenRef.current = open
  visibleNotificationCountRef.current = notifications.length

  const refreshUnreadCount = useCallback(async () => {
    try {
      const limit = panelOpenRef.current ? Math.max(PAGE_SIZE, Math.min(50, visibleNotificationCountRef.current)) : 1
      const response = await notificationsAPI.list(limit, 0)
      setUnreadCount(response.unreadCount)
      setTotal(response.total)
      if (panelOpenRef.current) {
        setNotifications(current => {
          const nextPage = [...response.notifications, ...current.slice(response.notifications.length)]
          return [...new Map(nextPage.map(notification => [notification._id, notification])).values()]
        })
        setHasMore(visibleNotificationCountRef.current < response.total)
      }
    } catch (loadError) {
      console.error('Failed to refresh notification count:', loadError)
    }
  }, [])

  const loadPage = useCallback(async (replace: boolean) => {
    if (replace) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const offset = replace ? 0 : notifications.length
      const response = await notificationsAPI.list(PAGE_SIZE, offset)
      setNotifications(current => replace ? response.notifications : [...current, ...response.notifications])
      setUnreadCount(response.unreadCount)
      setTotal(response.total)
      setHasMore(response.hasMore)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Notifications could not be loaded.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [notifications.length])

  useEffect(() => {
    void refreshUnreadCount()
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshUnreadCount()
    }
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshUnreadCount])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const togglePanel = () => {
    setActionError('')
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) void loadPage(true)
  }

  const markRead = async (notification: StudentNotification): Promise<boolean> => {
    if (notification.readAt) return true
    setBusyId(notification._id)
    setActionError('')
    try {
      const response = await notificationsAPI.markRead(notification._id)
      setNotifications(current => current.map(item => item._id === notification._id ? response.notification : item))
      setUnreadCount(count => Math.max(0, count - 1))
      return true
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'Could not mark this notification as read.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  const openNotification = async (notification: StudentNotification) => {
    if (!await markRead(notification)) return
    setOpen(false)
    onOpenNotification(notification)
  }

  const markAllRead = async () => {
    setBusyAction(true)
    setActionError('')
    try {
      await notificationsAPI.markAllRead()
      const readAt = new Date().toISOString()
      setNotifications(current => current.map(item => item.readAt ? item : { ...item, readAt }))
      setUnreadCount(0)
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'Could not mark notifications as read.')
    } finally {
      setBusyAction(false)
    }
  }

  const deleteNotification = async (notification: StudentNotification) => {
    setBusyId(notification._id)
    setActionError('')
    try {
      await notificationsAPI.delete(notification._id)
      setNotifications(current => current.filter(item => item._id !== notification._id))
      setTotal(count => Math.max(0, count - 1))
      if (!notification.readAt) setUnreadCount(count => Math.max(0, count - 1))
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'Could not delete this notification.')
    } finally {
      setBusyId(null)
    }
  }

  const clearAll = async () => {
    setBusyAction(true)
    setActionError('')
    try {
      await notificationsAPI.clearAll()
      setNotifications([])
      setUnreadCount(0)
      setTotal(0)
      setHasMore(false)
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'Could not clear notifications.')
    } finally {
      setBusyAction(false)
    }
  }

  return (
    <div className="nc-root" ref={panelRef}>
      <button
        type="button"
        className="db-icon-btn db-notif-btn nc-trigger"
        onClick={togglePanel}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notification-panel"
      >
        <span className="material-symbols-outlined">notifications</span>
        {unreadCount > 0 && <span className="nc-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <section className="nc-panel" id="notification-panel" aria-label="Notifications">
          <header className="nc-header">
            <div>
              <h2>Notifications</h2>
              <p>{unreadCount ? `${unreadCount} unread` : 'You are all caught up'}</p>
            </div>
            <button type="button" className="nc-close" onClick={() => setOpen(false)} aria-label="Close notifications">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>

          <div className="nc-toolbar">
            <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount || busyAction}>
              Mark all as read
            </button>
            <button type="button" onClick={() => void clearAll()} disabled={!total || busyAction}>
              Clear all
            </button>
          </div>

          {actionError && <p className="nc-error nc-action-error" role="alert">{actionError}</p>}
          {error ? (
            <div className="nc-state nc-error-state" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void loadPage(true)}>Retry</button>
            </div>
          ) : loading ? (
            <div className="nc-list" aria-label="Loading notifications">
              {Array.from({ length: 5 }, (_, index) => <div className="nc-skeleton" key={index}><i /><span /><span /></div>)}
            </div>
          ) : notifications.length === 0 ? (
            <div className="nc-empty">
              <span className="material-symbols-outlined">notifications_off</span>
              <strong>No notifications yet</strong>
              <p>Updates about tests, results, and your account will appear here.</p>
            </div>
          ) : (
            <div className="nc-list">
              {notifications.map(notification => (
                <article className={`nc-item${notification.readAt ? '' : ' nc-item--unread'}`} key={notification._id}>
                  <button
                    type="button"
                    className="nc-item-open"
                    onClick={() => void openNotification(notification)}
                    aria-label={`Open ${notification.title}${notification.readAt ? '' : ', unread'}`}
                  >
                    <span className={`nc-category-icon nc-category-icon--${notification.category}`}>
                      <span className="material-symbols-outlined">{categoryIcons[notification.category]}</span>
                    </span>
                    <span className="nc-copy">
                      <span className="nc-item-heading">
                        <strong>{notification.title}</strong>
                        {!notification.readAt && <i aria-label="Unread" />}
                      </span>
                      <span className="nc-message">{notification.message}</span>
                      <span className="nc-meta">
                        <span>{categoryLabels[notification.category]}</span>
                        <time dateTime={notification.createdAt}>{dateAndTime(notification.createdAt)}</time>
                      </span>
                    </span>
                  </button>
                  <div className="nc-item-actions">
                    {!notification.readAt && (
                      <button
                        type="button"
                        onClick={() => void markRead(notification)}
                        disabled={busyId === notification._id}
                        aria-label="Mark as read"
                        title="Mark as read"
                      >
                        <span className="material-symbols-outlined">done</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteNotification(notification)}
                      disabled={busyId === notification._id}
                      aria-label="Delete notification"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && !error && hasMore && (
            <button
              type="button"
              className="nc-load-more"
              onClick={() => void loadPage(false)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
