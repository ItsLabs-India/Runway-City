// Optional ATC voice: short radio calls spoken with the browser's speech synthesis. Off by default
// (browsers only allow sound after the player has interacted with the page, and many players
// prefer silence). Calls are dropped rather than queued when the game runs fast.
export class Radio {
  constructor() {
    this.on = false;
    this.supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.spoken = 0;
  }

  enable(on) {
    this.on = Boolean(on) && this.supported;
    if (!this.on && this.supported) speechSynthesis.cancel();
    return this.on;
  }

  say(text) {
    if (!this.on || speechSynthesis.pending) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /en[-_]IN/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
    u.rate = 1.15;
    u.pitch = 0.85;
    u.volume = 0.7;
    speechSynthesis.speak(u);
    this.spoken++;
  }
}
