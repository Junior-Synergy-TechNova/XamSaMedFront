import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, inject, output, signal, viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../../../components/icon/icon';
import { PageHead } from '../../../components/page-head/page-head';
import { AssistantService, ASSISTANT_MAX_CHARS } from '../../../services/assistant/assistant';
import { AuthService } from '../../../services/auth/auth';
import { GeoService } from '../../../services/geo/geo';
import { PlatformState } from '../../../services/platform/platform';
import { ApiAiErrorBody, ApiAiReply } from '../../../interfaces/api';
import { Observable } from 'rxjs';

/** Durée maximale d'une question dictée : l'enregistrement s'arrête et part seul. */
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
 * Dictée vocale (micro → /ai/transcribe) désactivée pour l'instant : la transcription
 * n'est pas assez fiable pour la démo. Le code reste en place — repasser à `true` pour la rétablir.
 */
export const VOICE_DICTATION_ENABLED = false;

@Component({
  selector: 'app-patient-assistant',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, PageHead],
  templateUrl: './patient-assistant.html',
  styleUrl: './patient-assistant.css',
})
export class PatientAssistant {
  private readonly assistant = inject(AssistantService);
  private readonly platform = inject(PlatformState);
  protected readonly geo = inject(GeoService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  /** Lien vers une autre section du shell (« Rechercher », « Pharmacies »). */
  readonly navigate = output<string>();

  readonly maxChars = ASSISTANT_MAX_CHARS;
  readonly suggestions = ASSISTANT_SUGGESTIONS;
  readonly messages = this.assistant.messages;
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly firstName = computed(() => (this.auth.user()?.name ?? '').trim().split(' ')[0] ?? '');

  /** Micro : seulement si la dictée est activée et que le navigateur sait enregistrer. */
  readonly canRecord = VOICE_DICTATION_ENABLED && typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
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
  /** Transcription en cours (après « Terminer ») : le texte arrive dans la zone de saisie. */
  readonly transcribing = signal(false);
  /** Le brouillon vient d'une dictée : le patient le relit, puis il part avec `source = voice`. */
  readonly dictated = signal(false);

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
    inject(DestroyRef).onDestroy(() => this.stopRecording(false));
  }

  onInput(e: Event): void {
    const v = (e.target as HTMLTextAreaElement).value.slice(0, ASSISTANT_MAX_CHARS);
    this.draft.set(v);
    if (!v.trim()) this.dictated.set(false);
  }

  /** Efface la dictée et réenregistre. */
  redo(): void {
    this.draft.set('');
    this.dictated.set(false);
    void this.startRecording();
  }

  /** Entrée envoie, Maj+Entrée va à la ligne. */
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
  }

  send(text = this.draft()): void {
    const message = text.trim();
    if (!message || this.sending() || this.recording() || this.transcribing()) return;
    const voice = this.dictated() && text === this.draft();
    this.draft.set('');
    this.dictated.set(false);
    this.assistant.push({ from: 'me', text: message, ...(voice ? { voice: true } : {}) });
    this.run(this.assistant.ask(message, this.geo.position(), voice), message, voice);
  }

  /** Renvoie la question d'un message d'erreur, qui disparaît. */
  retry(id: number, text: string): void {
    if (this.sending()) return;
    const voice = this.messages().some(m => m.from === 'me' && m.voice === true && m.text === text);
    this.assistant.drop(id);
    this.run(this.assistant.ask(text, this.geo.position(), voice), text, voice);
  }

  newConversation(): void {
    if (this.sending()) return;
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
    if (!this.canRecord || this.recording() || this.sending() || this.transcribing()) return;
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
      if (this.keepRecording) this.transcribe(blob, ext);
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

  /** `send` = false : « Annuler », rien n'est envoyé. */
  stopRecording(send: boolean): void {
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
   * POST /ai/transcribe : le texte compris arrive dans la zone de saisie, le patient
   * le relit et le corrige avant d'envoyer. Serveur sans cette route (404) :
   * on revient à POST /ai/voice, qui transcrit et répond d'un coup.
   */
  private transcribe(blob: Blob, ext: string): void {
    if (blob.size === 0) { this.platform.notify('L\'enregistrement est vide. Pouvez-vous réessayer ?', 'alert'); return; }
    this.transcribing.set(true);
    this.assistant.transcribe(blob, ext).subscribe({
      next: text => {
        this.transcribing.set(false);
        this.draft.set(text.slice(0, ASSISTANT_MAX_CHARS));
        this.dictated.set(true);
        afterNextRender(() => {
          const el = this.input()?.nativeElement;
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, { injector: this.injector });
      },
      error: (err: unknown) => {
        this.transcribing.set(false);
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.run(this.assistant.askByVoice(blob, ext, this.geo.position()), null);
          return;
        }
        this.platform.notify(errorText(err, true), 'alert');
      },
    });
  }

  /* ---------- Envoi commun ---------- */

  /** `question` = texte à renvoyer en cas d'échec (null pour la voix : il faut réenregistrer). */
  private run(call: Observable<ApiAiReply>, question: string | null, voice = false): void {
    this.sending.set(true);
    call.subscribe({
      next: r => {
        this.sending.set(false);
        this.assistant.sessionId.set(r.session_id);
        if (r.transcription) this.assistant.push({ from: 'me', text: r.transcription, voice: true });
        this.assistant.push({ from: 'bot', text: clean(r.reply), ...(r.urgence ? { kind: 'urgent' as const } : {}) });
      },
      error: (err: unknown) => {
        this.sending.set(false);
        const body = err instanceof HttpErrorResponse ? (err.error as ApiAiErrorBody | null) : null;
        if (body?.session_id) this.assistant.sessionId.set(body.session_id);
        // Pas de nouvel essai possible : assistant non configuré, ou voix (il faut réenregistrer).
        const retryable = question !== null && body?.code !== 'ai_not_configured';
        this.assistant.push({ from: 'bot', kind: 'error', text: errorText(err, question === null && !voice),
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
  return voice ? 'La question dictée n\'a pas pu être traitée. Réessayez ou tapez-la.' : 'L\'assistant n\'a pas pu répondre. Réessayez dans un instant.';
}
