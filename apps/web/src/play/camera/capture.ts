// play.md B.9: capture a photo of the camera frame plus the dog, with no UI in it.
// Decision (play.md asked us to pick one): the saved photo is what-you-see. With the front camera the preview is
// mirrored, so the photo is mirrored too; otherwise the dog would sit in a different place than it did on screen.
import type { Engine } from '../../engine';

/** Draw the video (cover-cropped exactly like the CSS preview) and then the engine canvas into one image. */
export async function composite(video: HTMLVideoElement, canvas: HTMLCanvasElement, engine: Engine, mirrored: boolean): Promise<Blob> {
  const w = canvas.width, h = canvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const x = out.getContext('2d')!;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw && vh) {
    const s = Math.max(w / vw, h / vh), dw = vw * s, dh = vh * s; // object-fit: cover
    x.save();
    if (mirrored) { x.translate(w, 0); x.scale(-1, 1); }
    x.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    x.restore();
  } else { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); }
  // A WebGL canvas is cleared after it is composited to the page, so render and read it back in the same task.
  engine.renderNow();
  x.drawImage(canvas, 0, 0, w, h);
  return new Promise((res, rej) => out.toBlob(b => (b ? res(b) : rej(new Error('capture failed'))), 'image/jpeg', 0.92));
}

/** Share sheet on phones, download elsewhere. */
export async function deliver(blob: Blob): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], `fetch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (e) { if ((e as DOMException).name === 'AbortError') return 'cancelled'; /* else fall through to download */ }
  }
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
