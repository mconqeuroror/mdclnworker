// Audio feedback system for better UX
// Creates satisfying click sounds using Web Audio API

class SoundFeedback {
  constructor() {
    this.audioContext = null;
    this.enabled = this.loadInitialEnabledState();
  }

  loadInitialEnabledState() {
    try {
      if (typeof window === "undefined") return true;
      const stored = window.localStorage.getItem("app_click_sound_enabled");
      if (stored == null) return true;
      return stored !== "false";
    } catch {
      return true;
    }
  }

  persistEnabledState() {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem("app_click_sound_enabled", String(this.enabled));
    } catch {
      // Ignore storage write failures.
    }
  }

  // Initialize audio context (must be called after user interaction)
  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // Subtle click sound for regular buttons
  playClick() {
    if (!this.enabled) return;
    this.init();

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // Short, high-pitched click
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    // Quick fade
    gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.05);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.05);
  }

  // Success sound for important actions (purchase, generation complete)
  playSuccess() {
    if (!this.enabled) return;
    this.init();

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // Two-tone success sound
    oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime);
    oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime + 0.08);
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.15);
  }

  // Satisfying "pop" for primary actions
  playPop() {
    if (!this.enabled) return;
    this.init();

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // Deep pop sound
    oscillator.frequency.setValueAtTime(150, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(80, this.audioContext.currentTime + 0.1);
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 0.1);
  }

  // Cashier "cha-ching" sound for purchases — dopamine hit
  playCashRegister() {
    if (!this.enabled) return;
    this.init();
    const now = this.audioContext.currentTime;

    // Coin drop — short metallic ping
    const osc1 = this.audioContext.createOscillator();
    const g1 = this.audioContext.createGain();
    osc1.connect(g1);
    g1.connect(this.audioContext.destination);
    osc1.frequency.setValueAtTime(1800, now);
    osc1.frequency.exponentialRampToValueAtTime(2400, now + 0.04);
    osc1.type = 'sine';
    g1.gain.setValueAtTime(0.12, now);
    g1.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc1.start(now);
    osc1.stop(now + 0.08);

    // Register bell — warm two-tone chime
    const osc2 = this.audioContext.createOscillator();
    const g2 = this.audioContext.createGain();
    osc2.connect(g2);
    g2.connect(this.audioContext.destination);
    osc2.frequency.setValueAtTime(880, now + 0.06);
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    osc2.type = 'sine';
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.35);

    // Subtle harmonic shimmer
    const osc3 = this.audioContext.createOscillator();
    const g3 = this.audioContext.createGain();
    osc3.connect(g3);
    g3.connect(this.audioContext.destination);
    osc3.frequency.setValueAtTime(1760, now + 0.1);
    osc3.type = 'sine';
    g3.gain.setValueAtTime(0, now);
    g3.gain.linearRampToValueAtTime(0.06, now + 0.12);
    g3.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc3.start(now + 0.1);
    osc3.stop(now + 0.4);
  }

  // Toggle sound on/off
  toggle() {
    this.enabled = !this.enabled;
    this.persistEnabledState();
    return this.enabled;
  }

  setEnabled(next) {
    this.enabled = next !== false;
    this.persistEnabledState();
    return this.enabled;
  }

  isEnabled() {
    return this.enabled;
  }
}

// Export singleton instance
export const sound = new SoundFeedback();
