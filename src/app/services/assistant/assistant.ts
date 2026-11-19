import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
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
      this.releaseAudio();
      this.messages.set([]);
      this.sessionId.set(null);
    }
  }

  /** Ajoute un message et renvoie son id. */
  push(msg: Omit<ChatMessage, 'id'>): number {
    const id = this.nextId++;
    this.messages.update(list => [...list, { ...msg, id }]);
    return id;
  }

  /** Complète un message déjà affiché (ex. la transcription d'un message vocal). */
  patch(id: number, changes: Partial<Omit<ChatMessage, 'id'>>): void {
    this.messages.update(list => list.map(m => m.id === id ? { ...m, ...changes } : m));
  }

  /** Libère les enregistrements gardés en mémoire (URL `blob:`) avant de vider le fil. */
  private releaseAudio(): void {
    for (const m of this.messages()) if (m.audioUrl) URL.revokeObjectURL(m.audioUrl);
  }

  /** Retire un message (erreur remplacée par un nouvel essai). */
  drop(id: number): void { this.messages.update(list => list.filter(m => m.id !== id)); }

  /** POST /ai/chat — `{ message, session_id?, lat?, lng? }`. */
  ask(message: string, at: GeoPoint | null): Observable<ApiAiReply> {
    return this.http.post<ApiAiReply>(`${this.base}/ai/chat`, {
      message, client: CLIENT,
      ...(this.sessionId() ? { session_id: this.sessionId() } : {}),
      ...(at ? { lat: at.lat, lng: at.lng } : {}),
    });
  }

  /**
   * POST /ai/voice — multipart `audio` (10 Mo max) : le serveur transcrit et répond d'un coup.
   * Mode vocal : la question part telle quelle, le patient ne relit pas de texte transcrit.
   */
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
    this.releaseAudio();
    this.messages.set([]);
    this.sessionId.set(null);
    if (sid) this.http.delete(`${this.base}/ai/chat/${encodeURIComponent(sid)}`).pipe(catchError(() => of(null))).subscribe();
  }
}
