import '../global-loader.css'

export default function SubmissionAnimation({ message = 'Submitting your test...' }: { message?: string }) {
  return (
    <div className="global-loader" role="status" aria-live="polite" aria-label={message}>
      <div className="global-loader-content">
        <div className="global-loader-fallback" aria-hidden="true" />
        <p className="global-loader-message">{message}</p>
      </div>
    </div>
  )
}
