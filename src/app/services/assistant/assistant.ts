import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiAiReply } from '../../interfaces/api';
import { ChatMessage } from '../../interfaces/models';
import { GeoPoint } from '../structures/structures';

/** Longueur maximale d'une question (validation `max:500` de l'API). */
export const ASSISTANT_MAX_CHARS = 500;

/** Le serveur adapte les écrans qu'il cite au site web (Rechercher, Pharmacies…) au lieu de l'app mobile. */
const CLIENT = 'web';

/**
 * Assistant IA patient (backend `AiController` / `VoiceChatController`, Groq) :
 * disponibilité des médicaments, pharmacies proches, réponse fixe aux urgences.
 *
 * Le fil reste en mémoire ici (il survit à un changement de section, pas à un
 * rechargement) et appartient au jeton qui l'a ouvert : un autre compte connecté
 * repart d'une conversation vide.
 */
@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  readonly messages = signal<ChatMessage[]>([]);
  readonly sessionId = signal<string | null>(null);
  private owner: string | null = null;
  private nextId = 1;

  /** Vide le fil s'il a été ouvert par un autre compte. */
  claim(): void {
    const token = localStorage.getItem('nova-token');
    if (token !== this.owner) {
      this.owner = token;
      this.messages.set([]);
      this.sessionId.set(null);
    }
  }

  push(msg: Omit<ChatMessage, 'id'>): void {
    this.messages.update(list => [...list, { ...msg, id: this.nextId++ }]);
  }

  /** Retire un message (erreur remplacée par un nouvel essai). */
  drop(id: number): void { this.messages.update(list => list.filter(m => m.id !== id)); }

  /** POST /ai/chat — `{ message, session_id?, lat?, lng? }`. */
  ask(message: string, at: GeoPoint | null, voice = false): Observable<ApiAiReply> {
    return this.http.post<ApiAiReply>(`${this.base}/ai/chat`, {
      message, client: CLIENT,
      // Question dictée puis relue : l'assistant tolère les approximations de la transcription.
      ...(voice ? { source: 'voice' } : {}),
      ...(this.sessionId() ? { session_id: this.sessionId() } : {}),
      ...(at ? { lat: at.lat, lng: at.lng } : {}),
    });
  }

  /** POST /ai/transcribe — texte seul, que le patient relit avant de l'envoyer (404 sur un ancien serveur). */
  transcribe(audio: Blob, ext: string): Observable<string> {
    const form = new FormData();
    form.append('audio', audio, `question.${ext}`);
    form.append('langue', 'fr');
    return this.http.post<{ transcription: string }>(`${this.base}/ai/transcribe`, form).pipe(map(r => (r.transcription ?? '').trim()));
  }

  /** POST /ai/voice — multipart `audio` (10 Mo max) ; la réponse ajoute `transcription`. */
  askByVoice(audio: Blob, ext: string, at: GeoPoint | null): Observable<ApiAiReply> {
    const form = new FormData();
    form.append('audio', audio, `question.${ext}`);
    form.append('langue', 'fr');
    form.append('client', CLIENT);
    const sid = this.sessionId();
    if (sid) form.append('session_id', sid);
    if (at) { form.append('lat', String(at.lat)); form.append('lng', String(at.lng)); }
    return this.http.post<ApiAiReply>(`${this.base}/ai/voice`, form);
  }

  /** Nouvelle conversation : DELETE /ai/chat/{session_id} (best-effort), puis fil vide. */
  reset(): void {
    const sid = this.sessionId();
    this.messages.set([]);
    this.sessionId.set(null);
    if (sid) this.http.delete(`${this.base}/ai/chat/${encodeURIComponent(sid)}`).pipe(catchError(() => of(null))).subscribe();
  }
}
