import type { PlayShell } from './shell';

export function run(shell: PlayShell) {
  const checks = { shell: !!shell, room: shell.session.lastView === 'room', pet: !!shell.session.bundle.id, lowQualityDefault: shell.session.quality === 'low', persistentSession: !!shell.session.position };
  const pass = Object.values(checks).every(Boolean);
  document.body.dataset.playAcceptance = pass ? 'pass' : 'fail';
  console.table(checks);
  if (!pass) throw new Error('Play acceptance checks failed');
}
