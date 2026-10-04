import { CameraView } from './camera/camera';
import { PlayShell } from './shell';

const stage = document.getElementById('stage')!, canvas = document.getElementById('pet') as HTMLCanvasElement, root = document.getElementById('ui')!;
const shell = new PlayShell(stage, canvas, root).register(new CameraView());
// Room (Person A) registers here when it exists; until then Play opens on the camera view.
shell.on(e => console.log('[play]', e.type, 'view' in e ? e.view : '', 'code' in e ? e.code : ''));
shell.start('room').catch(err => { root.textContent = `Could not start Play: ${err.message}`; });

(window as unknown as { play: PlayShell }).play = shell; // dev handle
