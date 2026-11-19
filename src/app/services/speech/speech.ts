import { Injectable, signal } from '@angular/core';

/**
 * Lecture à voix haute par la synthèse vocale du navigateur (Web Speech API, voix de l'appareil :
 * Siri sur iPhone, Google sur Android). Français uniquement : les appareils n'ont pas de voix
 * wolof ni pulaar. Rien ne part sur le réseau.
 *
 * - `unlock()` doit être appelé dans le geste de l'utilisateur (appui) : sans cela Safari iOS
 *   refuse de parler quand la réponse arrive plus tard.
 * - Les longs textes sont lus phrase par phrase : Chrome coupe une seule énonciation au bout
 *   d'une quinzaine de secondes.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  /** Synthèse vocale de l'appareil, lue une fois (null si le navigateur n'en a pas). */
  private readonly synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  readonly supported = this.synth !== null;
  /** Clé de ce qui est en cours de lecture (ex. id du message), sinon null. */
  readonly speaking = signal<number | null>(null);
  /** Lecture en cours : un `cancel()` invalide les rappels des énonciations précédentes. */
  private run = 0;

  /** Débloque la synthèse sur iOS (énonciation vide, dans le geste de l'utilisateur). */
  unlock(): void {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    this.synth.speak(u);
  }

  speak(key: number, text: string): void {
    const synth = this.synth;
    if (!synth) return;
    this.stop();
    const parts = (text.replace(/•/g, '').match(/[^.!?…:\n]+[.!?…:]*/g) ?? []).map(p => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const run = ++this.run;
    const voice = this.frenchVoice(synth);
    this.speaking.set(key);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang ?? 'fr-FR';
      if (voice) u.voice = voice;
      if (i === parts.length - 1) u.onend = () => { if (run === this.run) this.speaking.set(null); };
      u.onerror = () => { if (run === this.run) this.speaking.set(null); };
      synth.speak(u);
    });
  }

  stop(): void {
    if (!this.synth) return;
    this.run++;
    this.synth.cancel();
    this.speaking.set(null);
  }

  /** Voix française de l'appareil : de préférence fr-FR, puis toute variante fr-*. */
  private frenchVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    const voices = synth.getVoices();
    return voices.find(v => v.lang.toLowerCase().replace('_', '-') === 'fr-fr')
      ?? voices.find(v => v.lang.toLowerCase().startsWith('fr'))
      ?? null;
  }
}
