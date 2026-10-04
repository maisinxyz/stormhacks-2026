import { PlayShell } from './play/shell';
import './play/ui.css';
import './play/fonts.css';

async function bootPlay() {
  const shell = await PlayShell.start();
  (window as unknown as { playShell: PlayShell }).playShell = shell;
  const accept = new URLSearchParams(location.search).get('accept');
  if (accept === 'camera') { const { run } = await import('./play/camera/acceptance'); void run(shell); } // play.md B.13
  else if (accept === 'room') { const { run } = await import('./play/room/acceptance'); void run(shell); }
  else if (accept !== null) { const { run } = await import('./play/acceptance'); run(shell); }
  window.addEventListener('pagehide', () => shell.dispose());
}
void bootPlay();
