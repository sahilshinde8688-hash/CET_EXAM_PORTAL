import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import '../mobileQR.css'

interface MobileQRModalProps {
  isOpen: boolean
  onClose: () => void
  currentPath?: string
}

interface NetworkAddress {
  name: string
  address: string
}

export default function MobileQRModal({ isOpen, onClose, currentPath = window.location.pathname }: MobileQRModalProps) {
  const [activeTab, setActiveTab] = useState<'qr' | 'scanner'>('qr')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copied, setCopied] = useState<boolean>(false)
  const [addresses, setAddresses] = useState<NetworkAddress[]>([])
  const [selectedIp, setSelectedIp] = useState<string>('')
  const [port, setPort] = useState<number>(5173)
  const [scannedResult, setScannedResult] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState<boolean>(false)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Fetch local IPs from API
  useEffect(() => {
    if (!isOpen) return

    let isMounted = true
    const detectNetwork = async () => {
      try {
        const res = await fetch('/api/system/network-info')
        if (res.ok) {
          const data = await res.json()
          if (isMounted && data.success) {
            setAddresses(data.addresses || [])
            setSelectedIp(data.preferred || window.location.hostname || '127.0.0.1')
            if (data.port) setPort(data.port)
            return
          }
        }
      } catch (e) {
        console.warn('Could not fetch server network info, using local fallback:', e)
      }

      // Fallback
      if (isMounted) {
        const host = window.location.hostname
        setSelectedIp(host === 'localhost' ? '127.0.0.1' : host)
        setPort(Number(window.location.port) || 5173)
      }
    }

    void detectNetwork()

    return () => {
      isMounted = false
    }
  }, [isOpen])

  // Construct target mobile URL
  const mobileUrl = `${window.location.protocol}//${selectedIp || window.location.hostname || '127.0.0.1'}:${port}${currentPath || '/'}`

  // Generate QR Code data URL
  useEffect(() => {
    if (!isOpen || activeTab !== 'qr' || !mobileUrl) return

    QRCode.toDataURL(mobileUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('Failed to generate QR code:', err))
  }, [isOpen, activeTab, mobileUrl])

  // Camera scanner lifecycle
  useEffect(() => {
    if (!isOpen || activeTab !== 'scanner') {
      stopScanner()
      return
    }

    startScanner()

    return () => {
      stopScanner()
    }
  }, [isOpen, activeTab])

  const startScanner = async () => {
    setCameraError(null)
    setScannedResult(null)

    // Give DOM a tick to render the #qr-reader element
    await new Promise(r => setTimeout(r, 100))

    const readerElem = document.getElementById('qr-reader')
    if (!readerElem) return

    try {
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop()
        } catch {}
      }

      const html5QrCode = new Html5Qrcode('qr-reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      scannerRef.current = html5QrCode

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
        },
        decodedText => {
          setScannedResult(decodedText)
          try {
            if (navigator.vibrate) navigator.vibrate(100)
          } catch {}
        },
        () => {
          // Frame scan error (ignored, continuous searching)
        }
      )
      setIsScanning(true)
    } catch (err: any) {
      console.warn('Camera scanning init failed:', err)
      setCameraError(err?.message || 'Camera access denied or unavailable. You can upload a QR image below.')
      setIsScanning(false)
    }
  }

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current?.clear()
          scannerRef.current = null
          setIsScanning(false)
        })
        .catch(() => {
          scannerRef.current = null
          setIsScanning(false)
        })
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const html5QrCode = new Html5Qrcode('qr-file-dummy', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      const result = await html5QrCode.scanFile(file, true)
      setScannedResult(result)
      html5QrCode.clear()
    } catch (err: any) {
      alert('Could not detect a QR code in the selected image. Please try another image.')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(mobileUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) return null

  return (
    <div className="mqr-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mqr-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="mqr-header">
          <div className="mqr-header-title">
            <span className="material-symbols-outlined mqr-header-icon">qr_code_2</span>
            <div>
              <h3>CET NOVA on Phone</h3>
              <p>Connect your smartphone or scan a QR code</p>
            </div>
          </div>
          <button className="mqr-close-btn" onClick={onClose} aria-label="Close modal">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="mqr-tabs">
          <button
            type="button"
            className={`mqr-tab-btn ${activeTab === 'qr' ? 'mqr-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('qr')}
          >
            <span className="material-symbols-outlined">smartphone</span>
            Open on Phone
          </button>
          <button
            type="button"
            className={`mqr-tab-btn ${activeTab === 'scanner' ? 'mqr-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('scanner')}
          >
            <span className="material-symbols-outlined">document_scanner</span>
            Scan QR Code
          </button>
        </div>

        {/* Content Tab 1: QR Code */}
        {activeTab === 'qr' && (
          <div className="mqr-body">
            <div className="mqr-card">
              <div className="mqr-qr-wrapper">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR Code to open CET NOVA on phone" className="mqr-qr-image" />
                ) : (
                  <div className="mqr-loading-qr">
                    <span className="material-symbols-outlined mqr-spin">progress_activity</span>
                    <span>Generating QR...</span>
                  </div>
                )}
              </div>

              <div className="mqr-url-box">
                <span className="material-symbols-outlined mqr-link-icon">link</span>
                <input
                  type="text"
                  readOnly
                  value={mobileUrl}
                  className="mqr-url-input"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button type="button" className="mqr-copy-btn" onClick={handleCopy}>
                  <span className="material-symbols-outlined">{copied ? 'check' : 'content_copy'}</span>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              {addresses.length > 1 && (
                <div className="mqr-ip-selector">
                  <label htmlFor="mqr-ip-select">Network IP:</label>
                  <select
                    id="mqr-ip-select"
                    value={selectedIp}
                    onChange={e => setSelectedIp(e.target.value)}
                    className="mqr-select"
                  >
                    {addresses.map(a => (
                      <option key={a.address} value={a.address}>
                        {a.name} ({a.address})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mqr-steps">
              <div className="mqr-step-item">
                <span className="mqr-step-badge">1</span>
                <div>
                  <strong>Connect Same Wi-Fi</strong>
                  <p>Ensure your phone and this computer are on the same Wi-Fi network.</p>
                </div>
              </div>
              <div className="mqr-step-item">
                <span className="mqr-step-badge">2</span>
                <div>
                  <strong>Scan with Camera</strong>
                  <p>Open Camera or Google Lens on your phone and point it at the code.</p>
                </div>
              </div>
              <div className="mqr-step-item">
                <span className="mqr-step-badge">3</span>
                <div>
                  <strong>Instant Practice</strong>
                  <p>Tap the link to use CET NOVA in full portrait mobile layout!</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content Tab 2: Camera Scanner */}
        {activeTab === 'scanner' && (
          <div className="mqr-body">
            <div className="mqr-scanner-container">
              <div id="qr-reader" className="mqr-camera-feed" />
              <div id="qr-file-dummy" style={{ display: 'none' }} />

              {cameraError && (
                <div className="mqr-camera-alert">
                  <span className="material-symbols-outlined">videocam_off</span>
                  <p>{cameraError}</p>
                </div>
              )}

              {scannedResult && (
                <div className="mqr-result-box">
                  <div className="mqr-result-header">
                    <span className="material-symbols-outlined">check_circle</span>
                    <strong>Scanned QR Result:</strong>
                  </div>
                  <p className="mqr-result-text">{scannedResult}</p>
                  <div className="mqr-result-actions">
                    {scannedResult.startsWith('http://') || scannedResult.startsWith('https://') ? (
                      <a
                        href={scannedResult}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mqr-action-btn mqr-action-btn--primary"
                      >
                        <span className="material-symbols-outlined">open_in_new</span>
                        Open Link
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="mqr-action-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(scannedResult)
                        alert('Copied to clipboard!')
                      }}
                    >
                      <span className="material-symbols-outlined">content_copy</span>
                      Copy Text
                    </button>
                    <button
                      type="button"
                      className="mqr-action-btn"
                      onClick={() => {
                        setScannedResult(null)
                        startScanner()
                      }}
                    >
                      <span className="material-symbols-outlined">refresh</span>
                      Scan Again
                    </button>
                  </div>
                </div>
              )}

              <div className="mqr-scanner-actions">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className="mqr-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="material-symbols-outlined">add_photo_alternate</span>
                  Upload QR Image Instead
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mqr-footer">
          <button type="button" className="mqr-done-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
