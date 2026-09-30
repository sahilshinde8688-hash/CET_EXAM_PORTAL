import '../global-loader.css'

export default function SubmissionAnimation() {
  return (
    <div className="global-loader" role="status" aria-live="polite" aria-label="Submitting your test">
      <div className="global-loader-content">
        <div className="global-loader-fallback" aria-hidden="true" />
        <p className="global-loader-message">Submitting your test...</p>
      </div>
    </div>
  )
}
