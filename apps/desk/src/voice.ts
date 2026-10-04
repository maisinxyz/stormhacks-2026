type SpeechRecognitionResultEventLike = { results: { [index: number]: { [index: number]: { transcript: string } } } }
type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

type RecognitionConstructor = new () => Recognition

declare global {
  interface Window { webkitSpeechRecognition?: RecognitionConstructor; SpeechRecognition?: RecognitionConstructor }
}

export function getSpeechRecognition(): Recognition | null {
  const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition
  return Constructor ? new Constructor() : null
}

export async function unlockMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch { return false }
}

export function speakWithBrowserTts(text: string, onAmplitude: (value: number) => void, onDone: () => void) {
  if (!('speechSynthesis' in window)) { onDone(); return }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  let frame = 0
  const pulse = () => {
    onAmplitude(.18 + Math.abs(Math.sin(frame / 3)) * .62)
    frame += 1
    if (window.speechSynthesis.speaking) requestAnimationFrame(pulse)
    else { onAmplitude(0); onDone() }
  }
  utterance.onstart = () => requestAnimationFrame(pulse)
  utterance.onend = () => { onAmplitude(0); onDone() }
  utterance.onerror = () => { onAmplitude(0); onDone() }
  window.speechSynthesis.speak(utterance)
}
