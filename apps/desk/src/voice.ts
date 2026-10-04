// Speech-to-text and the pet's voice are ElevenLabs (shared with the Play app: @fetch/web/src/voice). This only primes the mic permission.
export async function unlockMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch { return false }
}
