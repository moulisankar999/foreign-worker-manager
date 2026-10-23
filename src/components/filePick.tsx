/* Every photo / attachment picker offers both: "Take photo" (device camera) and "Upload from device" (gallery or files).
 * Android APK: the Capacitor WebView opens the camera for inputs with `capture` (CAMERA permission in the manifest)
 * and the normal file / gallery chooser for inputs without it. */
import { useRef, useState } from 'react'
import { Icon } from './Icon'

export function FilePick({ accept = 'image/*,application/pdf', multiple, onFiles, camera = true, facing = 'environment', allowFlip, small, takeLabel = 'Take photo', uploadLabel = 'Upload from device', disabled, name }: {
  accept?: string; multiple?: boolean; onFiles: (files: File[]) => void; camera?: boolean; facing?: 'environment' | 'user'; allowFlip?: boolean
  small?: boolean; takeLabel?: string; uploadLabel?: string; disabled?: boolean; name?: string
}) {
  const cam = useRef<HTMLInputElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [face, setFace] = useState(facing)
  const done = (l: FileList | null, el: HTMLInputElement | null) => { const f = Array.from(l || []); if (el) el.value = ''; if (f.length) onFiles(f) }
  const cls = `btn btn-secondary${small ? ' btn-s' : ''}`
  return (
    <span className="filepick row gap-s wrap" data-name={name}>
      {camera && <>
        <button type="button" className={cls} disabled={disabled} onClick={() => cam.current?.click()}><Icon name="camera" size={small ? 16 : 18} /><span>{takeLabel}</span></button>
        <input ref={cam} type="file" accept="image/*" capture={face} hidden aria-label={takeLabel} onChange={(e) => done(e.target.files, e.target)} />
        {allowFlip && <button type="button" className="link small" disabled={disabled} onClick={() => setFace(face === 'user' ? 'environment' : 'user')} title="Which camera to open (phones may ignore this hint)">{face === 'user' ? 'Front camera (selfie)' : 'Back camera'} ⇄</button>}
      </>}
      <button type="button" className={cls} disabled={disabled} onClick={() => pick.current?.click()}><Icon name="upload" size={small ? 16 : 18} /><span>{uploadLabel}</span></button>
      <input ref={pick} type="file" accept={accept} multiple={multiple} hidden aria-label={uploadLabel} onChange={(e) => done(e.target.files, e.target)} />
    </span>
  )
}
