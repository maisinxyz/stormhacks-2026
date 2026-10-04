import { PlayShell } from './play/shell';
import './play/ui.css';
import './play/fonts.css';

async function bootPlay() {
  const shell = await PlayShell.start();
  (window as unknown as { playShell: PlayShell }).playShell = shell;
  if (new URLSearchParams(location.search).has('accept')) { const { run } = await import('./play/acceptance'); run(shell); }
  window.addEventListener('pagehide', () => shell.dispose());
}
void bootPlay();
