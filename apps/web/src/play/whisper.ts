// On-device speech recognition for the Play shell: Whisper (tiny, English) running in the browser through
// transformers.js. It needs no key, no server and no Google/Apple speech service, so voice works in Brave, in a
// WebView, and behind a VPN. The model (about 40 MB) downloads once, on first use, then lives in the browser cache.
// ponytail: runs on the CPU (WASM) so it works everywhere; about 1-2 s for a short phrase on a laptop, slower on an
// iPhone. WebGPU would be faster where it exists.
type Run = (audio: Float32Array) => Promise<{ text: string } | { text: string }[]>;

let loading: Promise<Run> | undefined;
export let whisperReady = false;

/** Start (or join) the model download. `onProgress` gets 0-100 while files download. */
export function loadWhisper(onProgress?: (pct: number) => void): Promise<Run> {
  loading ??= import('@huggingface/transformers').then(async ({ pipeline, env }) => {
    env.allowLocalModels = false; // models come from the Hugging Face hub (then the browser cache)
    const files = new Map<string, number>();
    const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      dtype: 'q8',
      progress_callback: (e: { status: string; file?: string; progress?: number }) => {
        if (e.status === 'progress' && e.file) { files.set(e.file, e.progress ?? 0); onProgress?.([...files.values()].reduce((a, b) => a + b, 0) / files.size); }
      },
    });
    whisperReady = true;
    return ((audio: Float32Array) => asr(audio)) as Run;
  }).catch(err => { loading = undefined; throw err; }); // a failed download can be retried on the next press
  return loading;
}

/** 16 kHz mono samples -> text ('' when nothing intelligible). */
export async function transcribe(pcm: Float32Array): Promise<string> {
  const out = await (await loadWhisper())(pcm);
  return (Array.isArray(out) ? out[0]?.text : out.text)?.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim() ?? ''; // drop "[BLANK_AUDIO]", "(music)"
}

/** Recorded audio (webm, mp4, ...) -> 16 kHz mono Float32, which is what Whisper wants. */
export async function toPcm(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start();
    return (await off.startRendering()).getChannelData(0);
  } finally { void ctx.close(); }
}

/** Loudness of the clip (0..1). Whisper invents words ("Thank you.") from silence, so quiet clips are skipped. */
export function rms(pcm: Float32Array) {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}
