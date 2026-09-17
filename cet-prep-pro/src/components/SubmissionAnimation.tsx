import { useEffect, useRef } from 'react'
import lottie from 'lottie-web'
import animationData from '../assets/online-exam.json'
import '../global-loader.css'

export default function SubmissionAnimation() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const animation = lottie.loadAnimation({
      container: container.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData,
    })

    return () => animation.destroy()
  }, [])

  return (
    <div className="global-loader" role="status" aria-live="polite" aria-label="Submitting your test">
      <div className="global-loader-content">
        <div ref={container} className="global-loader-animation" />
        <p className="global-loader-message">Submitting your test...</p>
      </div>
    </div>
  )
}
