import '../loading-indicator.css'

type Props = { message: string }

export default function LoadingIndicator({ message }: Props) {
  return (
    <div className="inline-loading-indicator" role="status" aria-live="polite">
      <span className="material-symbols-outlined inline-loading-spinner" aria-hidden="true">progress_activity</span>
      <span>{message}</span>
    </div>
  )
}
