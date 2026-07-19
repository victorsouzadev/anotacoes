let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/** Dois bipes curtos ao trocar de fase (foco↔pausa) — Web Audio pura, sem <audio>,
 * sem asset externo e sem pedir permissão do navegador (ao contrário da Notification API). */
export function playPomodoroBeep(): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  beepAt(ctx, now, 880);
  beepAt(ctx, now + 0.2, 880);
}

function beepAt(ctx: AudioContext, startAt: number, freq: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + 0.16);
}
