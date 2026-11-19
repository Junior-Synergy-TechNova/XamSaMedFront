import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, output, signal, viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../../../components/icon/icon';
import { PageHead } from '../../../components/page-head/page-head';
import { AssistantService, ASSISTANT_MAX_CHARS } from '../../../services/assistant/assistant';
import { AuthService } from '../../../services/auth/auth';
import { GeoService } from '../../../services/geo/geo';
import { PlatformState } from '../../../services/platform/platform';
import { SpeechService } from '../../../services/speech/speech';
import { ApiAiErrorBody, ApiAiReply } from '../../../interfaces/api';
import { Observable } from 'rxjs';

/** Durée maximale d'un message vocal : l'enregistrement s'arrête et part seul. */
const MAX_RECORD_S = 45;

/** Barres de l'indicateur de niveau du micro. */
const LEVEL_BARS = 28;

/** Formats que le navigateur sait enregistrer et que l'API accepte (`mimes:` de /ai/voice). */
const AUDIO_TYPES: readonly { mime: string; ext: string }[] = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mime: 'audio/mp4', ext: 'm4a' },
];

export const ASSISTANT_SUGGESTIONS: readonly string[] = [
  'Où trouver du paracétamol près de chez moi ?',
  "L'amoxicilline demande-t-elle une ordonnance ?",
  "Je cherche de l'insuline glargine",
  'Quelles pharmacies sont autour de moi ?',
];

/* ============================================================
   PATIENT — Assistant IA (POST /ai/chat, POST /ai/voice)
   Disponibilités, pharmacies proches ; urgences = réponse fixe.
   ============================================================ */
/**
 * Mode vocal (micro → POST /ai/voice) : la question enregistrée part directement, sans afficher
 * ni faire relire le texte transcrit ; elle apparaît dans le fil comme un message vocal.
 * `false` masque le micro.
 */
export const VOICE_ENABLED = true;

@Component({
  selector: 'app-patient-assistant',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PageHead],
  templateUrl: './patient-assistant.html',
  styleUrl: './patient-assistant.css',
  // Pendant un enregistrement : Entrée envoie le message vocal, Échap l'annule (où que soit le focus).
  host: { '(document:keydown)': 'onRecordingKey($event)' },
})
export class PatientAssistant {
  private readonly assistant = inject(AssistantService);
  private readonly platform = inject(PlatformState);
  protected readonly geo = inject(GeoService);
  private readonly auth = inject(AuthService);
  /** Réponses lues à voix haute (voix de l'appareil, en français). */
  readonly speech = inject(SpeechService);

  /** Lien vers une autre section du shell (« Rechercher », « Pharmacies »). */
  readonly navigate = output<string>();

  readonly maxChars = ASSISTANT_MAX_CHARS;
  readonly suggestions = ASSISTANT_SUGGESTIONS;
  readonly messages = this.assistant.messages;
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly firstName = computed(() => (this.auth.user()?.name ?? '').trim().split(' ')[0] ?? '');

  /** Micro : seulement si le mode vocal est activé et que le navigateur sait enregistrer. */
  readonly canRecord = VOICE_ENABLED && typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  readonly recording = signal(false);
  readonly recordSeconds = signal(0);
  readonly recordLeft = computed(() => MAX_RECORD_S - this.recordSeconds());
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** false = « Annuler » : l'enregistrement est jeté au lieu d'être envoyé. */
  private keepRecording = true;
  /** Niveau du micro (0–1) sur les dernières fractions de seconde : le patient voit qu'on l'entend. */
  readonly levels = signal<number[]>(Array<number>(LEVEL_BARS).fill(0));
  private audioCtx: AudioContext | null = null;
  private meterFrame = 0;

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    this.assistant.claim();
    // Chaque nouveau message (ou l'indicateur « écrit… ») ramène le fil en bas.
    afterRenderEffect(() => {
      this.messages();
      this.sending();
      const el = this.thread()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
    inject(DestroyRef).onDestroy(() => { this.stopRecording(false); this.speech.stop(); this.stopPlayback(); });
  }

  /** « Écouter » / « Arrêter » sur une réponse. */
  toggleSpeak(id: number, text: string): void {
    if (this.speech.speaking() === id) this.speech.stop();
    else { this.stopPlayback(); this.speech.speak(id, text); }
  }

  onInput(e: Event): void {
    this.draft.set((e.target as HTMLTextAreaElement).value.slice(0, ASSISTANT_MAX_CHARS));
  }

  /** Entrée envoie, Maj+Entrée va à la ligne. */
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
  }

  send(text = this.draft()): void {
    const message = text.trim();
    if (!message || this.sending() || this.recording()) return;
    this.draft.set('');
    this.assistant.push({ from: 'me', text: message });
    this.run(this.assistant.ask(message, this.geo.position()), message);
  }

  /** Renvoie la question d'un message d'erreur, qui disparaît. */
  retry(id: number, text: string): void {
    if (this.sending()) return;
    this.assistant.drop(id);
    this.run(this.assistant.ask(text, this.geo.position()), text);
  }

  newConversation(): void {
    if (this.sending()) return;
    this.speech.stop();
    this.stopPlayback();
    this.assistant.reset();
    this.input()?.nativeElement.focus();
  }

  useMyPosition(): void {
    this.geo.locate().then(
      () => this.platform.notify('Position enregistrée : l\'assistant citera les pharmacies autour de vous.'),
      reason => this.platform.notify(GeoService.failureMessage(reason), 'alert'),
    );
  }

  /* ---------- Question à la voix ---------- */

  async startRecording(): Promise<void> {
    if (!this.canRecord || this.recording() || this.sending()) return;
    this.speech.stop(); // on n'enregistre pas l'assistant en train de parler
    this.stopPlayback();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.platform.notify(denied
        ? 'Micro refusé : autorisez le micro pour ce site dans votre navigateur, ou tapez votre question.'
        : 'Aucun micro disponible : tapez votre question.', 'alert');
      return;
    }
    const type = AUDIO_TYPES.find(t => MediaRecorder.isTypeSupported(t.mime));
    const rec = new MediaRecorder(this.stream, type ? { mimeType: type.mime } : undefined);
    this.recorder = rec;
    this.chunks = [];
    this.keepRecording = true;
    rec.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: rec.mimeType || type?.mime || 'audio/webm' });
      const ext = AUDIO_TYPES.find(t => blob.type.startsWith(t.mime.split(';')[0]))?.ext ?? 'webm';
      this.releaseMic();
      if (this.keepRecording) this.sendVoice(blob, ext, this.recordSeconds());
    };
    rec.start();
    this.startMeter(this.stream);
    this.recording.set(true);
    this.recordSeconds.set(0);
    this.timer = setInterval(() => {
      this.recordSeconds.update(s => s + 1);
      if (this.recordSeconds() >= MAX_RECORD_S) this.stopRecording(true);
    }, 1000);
  }

  /** Raccourcis clavier pendant l'enregistrement : Entrée = envoyer, Échap = annuler. */
  onRecordingKey(e: KeyboardEvent): void {
    if (!this.recording() || e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); this.stopRecording(true); }
    else if (e.key === 'Escape') { e.preventDefault(); this.stopRecording(false); }
  }

  /** `send` = false : « Annuler », rien n'est envoyé. */
  stopRecording(send: boolean): void {
    // Appui sur « Envoyer » : débloque la voix (iOS) pour lire la réponse quand elle arrivera.
    if (send && this.recording()) this.speech.unlock();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.stopMeter();
    this.recording.set(false);
    this.keepRecording = send;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else this.releaseMic();
    this.recorder = null;
  }

  private releaseMic(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  /** Niveau du micro lu par un AnalyserNode (rien n'est envoyé : tout reste dans le navigateur). */
  private startMeter(stream: MediaStream): void {
    if (typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    this.audioCtx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number) => {
      this.meterFrame = requestAnimationFrame(tick);
      if (t - last < 70) return; // ~14 images/s suffisent
      last = t;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      this.levels.update(l => [...l.slice(1), level]);
    };
    this.meterFrame = requestAnimationFrame(tick);
  }

  private stopMeter(): void {
    cancelAnimationFrame(this.meterFrame);
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.levels.set(Array<number>(LEVEL_BARS).fill(0));
  }

  /**
   * Mode vocal : la question enregistrée part telle quelle à POST /ai/voice (transcription + réponse
   * en un appel). Le fil montre un message vocal (durée), jamais le texte transcrit.
   */
  private sendVoice(blob: Blob, ext: string, seconds: number): void {
    if (blob.size === 0) { this.platform.notify('L\'enregistrement est vide. Pouvez-vous réessayer ?', 'alert'); return; }
    const audioUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : undefined;
    const id = this.assistant.push({ from: 'me', text: '', voice: true, seconds: Math.max(1, seconds), ...(audioUrl ? { audioUrl } : {}) });
    this.run(this.assistant.askByVoice(blob, ext, this.geo.position()), null, true, id);
  }

  /* ---------- Réécoute d'un message vocal ---------- */

  /** Message vocal en cours de réécoute (id), sinon null. */
  readonly playing = signal<number | null>(null);
  private player: HTMLAudioElement | null = null;

  togglePlay(id: number, url: string): void {
    if (this.playing() === id) { this.stopPlayback(); return; }
    this.stopPlayback();
    this.speech.stop();
    const audio = new Audio(url);
    this.player = audio;
    audio.onended = () => { if (this.player === audio) this.stopPlayback(); };
    audio.onerror = () => { if (this.player === audio) this.stopPlayback(); };
    this.playing.set(id);
    // `play()` renvoie une promesse rejetée si la lecture est refusée (format, autorisation).
    void Promise.resolve(audio.play()).catch(() => { if (this.player === audio) this.stopPlayback(); });
  }

  private stopPlayback(): void {
    this.player?.pause();
    this.player = null;
    this.playing.set(null);
  }

  /* ---------- Envoi commun ---------- */

  /**
   * `question` = texte à renvoyer en cas d'échec (null pour la voix : il faut réenregistrer).
   * `speak` = question posée à la voix : la réponse est lue à voix haute dès qu'elle arrive.
   */
  private run(call: Observable<ApiAiReply>, question: string | null, speak = false, voiceId?: number): void {
    this.sending.set(true);
    call.subscribe({
      next: r => {
        this.sending.set(false);
        this.assistant.sessionId.set(r.session_id);
        // Message vocal : le texte compris s'affiche en petit sous la bulle.
        const heard = r.transcription?.trim();
        if (voiceId !== undefined && heard) this.assistant.patch(voiceId, { transcript: heard });
        const text = clean(r.reply);
        const id = this.assistant.push({ from: 'bot', text, ...(r.urgence ? { kind: 'urgent' as const } : {}) });
        if (speak) this.speech.speak(id, text);
      },
      error: (err: unknown) => {
        this.sending.set(false);
        const body = err instanceof HttpErrorResponse ? (err.error as ApiAiErrorBody | null) : null;
        if (body?.session_id) this.assistant.sessionId.set(body.session_id);
        // Pas de nouvel essai possible : assistant non configuré, ou voix (il faut réenregistrer).
        const retryable = question !== null && body?.code !== 'ai_not_configured';
        this.assistant.push({ from: 'bot', kind: 'error', text: errorText(err, question === null),
          ...(retryable ? { retry: question } : {}) });
      },
    });
  }
}

/** Le modèle écrit parfois en Markdown : on garde le texte, sans les astérisques. */
function clean(reply: string): string {
  return reply.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*[*-]\s+/gm, '• ').trim();
}

function errorText(err: unknown, voice: boolean): string {
  if (!(err instanceof HttpErrorResponse)) return 'La réponse n\'a pas pu être lue. Réessayez.';
  const body = err.error as ApiAiErrorBody | null;
  if (err.status === 0) return 'Connexion impossible. Vérifiez votre réseau puis réessayez.';
  if (err.status === 429) return body?.message ?? 'Trop de questions d\'affilée. Patientez une minute puis réessayez.';
  if (body?.code === 'ai_not_configured') return 'L\'assistant n\'est pas encore activé sur ce serveur. Utilisez la recherche de médicaments en attendant.';
  if (body?.code === 'transcription_empty') return body.message ?? 'Je n\'ai pas compris l\'enregistrement. Pouvez-vous répéter, plus près du micro ?';
  if (err.status === 422 && body?.errors?.['audio']) return 'Enregistrement refusé (format ou taille). Réessayez, ou tapez votre question.';
  if (body?.message) return body.message;
  return voice ? 'Le message vocal n\'a pas pu être traité. Réenregistrez-le ou tapez votre question.' : 'L\'assistant n\'a pas pu répondre. Réessayez dans un instant.';
}
