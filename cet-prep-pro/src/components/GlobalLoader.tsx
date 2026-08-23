import { useEffect, useRef } from 'react'
import lottie from 'lottie-web'
import animationData from '../../public/abstract-isometric-loader.json'

type LoaderProps = { message?: string }

export default function GlobalLoader({ message = 'Loading your workspace' }: LoaderProps) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const anim = lottie.loadAnimation({
      container: container.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: animationData
    })
    return () => anim.destroy()
  }, [])

  return (
    <div className="global-loader" role="status" aria-live="polite" aria-label={message}>
      <div className="global-loader-content">
        <div ref={container} className="global-loader-animation" style={{ width: 256, height: 256 }} />
        <p className="global-loader-message">{message}</p>
      </div>
    </div>
  )
}
