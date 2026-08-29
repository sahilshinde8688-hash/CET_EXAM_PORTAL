import { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import '../settings.css'

interface ImageCropModalProps {
  image: string
  onCancel: () => void
  onConfirm: (file: File) => void
}

const createCroppedFile = (image: string, crop: Area): Promise<File> => new Promise((resolve, reject) => {
  const source = new Image()
  source.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = crop.width
    canvas.height = crop.height
    const context = canvas.getContext('2d')
    if (!context) {
      reject(new Error('Unable to prepare image crop'))
      return
    }
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Unable to create cropped image'))
        return
      }
      resolve(new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }
  source.onerror = () => reject(new Error('Unable to read selected image'))
  source.src = image
})

export default function ImageCropModal({ image, onCancel, onConfirm }: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [processing, setProcessing] = useState(false)

  const handleCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedArea(pixels)
  }, [])

  const handleConfirm = async () => {
    if (!croppedArea) return
    setProcessing(true)
    try {
      const file = await createCroppedFile(image, croppedArea)
      onConfirm(file)
    } catch (error) {
      console.error('Failed to crop image:', error)
      setProcessing(false)
    }
  }

  return (
    <div className="image-crop-overlay" role="dialog" aria-modal="true" aria-labelledby="crop-photo-title">
      <div className="image-crop-modal">
        <div className="image-crop-header">
          <div><span className="profile-kicker">Profile photo</span><h2 id="crop-photo-title">Adjust your image</h2></div>
          <button type="button" className="image-crop-close" onClick={onCancel} aria-label="Close crop dialog">×</button>
        </div>
        <div className="image-crop-area"><Cropper image={image} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={handleCropComplete} /></div>
        <div className="image-crop-controls"><label htmlFor="crop-zoom">Zoom</label><input id="crop-zoom" type="range" min="1" max="3" step="0.05" value={zoom} onChange={event => setZoom(Number(event.target.value))} /><span>{zoom.toFixed(1)}×</span></div>
        <div className="image-crop-actions"><button type="button" onClick={onCancel} disabled={processing}>Cancel</button><button type="button" className="is-primary" onClick={handleConfirm} disabled={processing || !croppedArea}>{processing ? 'Preparing...' : 'Use This Photo'}</button></div>
      </div>
    </div>
  )
}
