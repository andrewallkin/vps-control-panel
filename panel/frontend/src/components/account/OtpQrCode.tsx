import QRCode from 'qrcode'
import { useEffect, useRef } from 'react'

export function OtpQrCode({ uri }: { uri: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !uri) {
      return
    }
    void QRCode.toCanvas(canvas, uri, { margin: 1, width: 180 })
  }, [uri])

  return <canvas ref={canvasRef} aria-label="QR code for setting up your authenticator app" role="img" />
}
