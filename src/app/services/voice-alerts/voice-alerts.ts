import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, from, map, shareReplay, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiVoiceAlert, AudioManifest, VoiceLang } from '../../interfaces/api';

/** Langues des alertes vocales, dans l'ordre du sélecteur. */
export const VOICE_LANGS: readonly { id: VoiceLang; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'wo', label: 'Wolof' },
  { id: 'ff', label: 'Pulaar' },
  { id: 'srr', label: 'Sérère' },
];

/**
 * Texte français de chaque segment (backend `docs/AUDIO_SEGMENTS.csv`) : affiché
 * pendant la lecture, et seul affiché quand l'audio manque (règle 3).
 */
export const SEGMENT_TEXT: Readonly<Record<string, string>> = {
  OUV_01: 'Bonjour. Ici votre armoire XamSaMed.',
  POUR_MOI: 'Ce message concerne vos médicaments.',
  MED_INTRO: 'Le médicament est :',
  CLO_01: 'Pour toute question, parlez-en à votre pharmacien.',
  CLO_03: 'Merci, à bientôt.',
  PER_J30: 'Ce médicament expire dans un mois. Pensez à en acheter un nouveau.',
  PER_J7: 'Attention. Ce médicament expire dans une semaine. Rendez-vous rapidement en pharmacie.',
  PER_J1: 'Urgent. Ce médicament expire demain. Allez en pharmacie aujourd\'hui.',
  PER_J0: 'Ce médicament est périmé aujourd\'hui. Ne l\'utilisez plus. Rapportez-le à votre pharmacien.',
  PER_EXPIRE: 'Attention. Ce médicament est périmé. Ne l\'utilisez plus. Rapportez-le à votre pharmacien.',
  CHA_RISK: 'Ce médicament est peut-être exposé à la chaleur depuis :',
  DUR_2H: 'deux heures', DUR_4H: 'quatre heures', DUR_6H: 'six heures', DUR_12H: 'douze heures',
  DUR_1J: 'un jour', DUR_2J: 'deux jours', DUR_3J: 'trois jours', DUR_1S: 'une semaine',
  CHA_CONSIGNE_FROID: 'Vérifiez où il est rangé et remettez-le au réfrigérateur immédiatement.',
  CHA_CONSIGNE_FRAIS: 'Vérifiez où il est rangé et gardez-le dans un endroit frais, à l\'abri du soleil.',
  CHA_NOTE: 'Cette alerte est basée sur la météo de votre quartier. La température réelle peut être différente.',
};

export type VoiceAlertKind = 'expiry' | 'thermal';

/** Un segment du message : son texte à l'écran et le fichier à jouer (null = texte seul). */
export interface VoiceLine { id: string; text: string; src: string | null; }

/** Message prêt : `lang` = langue réellement jouée (repli français possible). */
export interface VoicePlan { lang: VoiceLang; lines: VoiceLine[]; audio: boolean; }

/** `MED_*` (sauf MED_INTRO) et `DUR_*` : seuls segments remplaçables un à un par le français. */
const replaceable = (id: string) => (id.startsWith('MED_') && id !== 'MED_INTRO') || id.startsWith('DUR_');

/**
 * Règles de repli de l'app mobile (backend `docs/mobile.md` § 14) :
 * 1. `MED_*` / `DUR_*` absent dans la langue → ce segment en français ;
 * 2. autre segment absent → tout le message en français ;
 * 3. segment absent aussi en français → aucun audio, le texte seul à l'écran.
 * Un fichier listé dans `unmapped_files` compte comme manquant.
 */
export function planVoice(manifest: AudioManifest, lang: VoiceLang, segments: string[], medicineLabel: string): VoicePlan {
  const files = (l: VoiceLang) => {
    const entry = manifest.languages[l];
    const unmapped = new Set(entry?.unmapped_files ?? []);
    return new Map((entry?.segments ?? []).filter(s => !unmapped.has(s.file)).map(s => [s.id, `audio/${l}/${s.file}`]));
  };
  const fr = files('fr');
  let use = lang;
  let own = files(lang);
  if (segments.some(id => !replaceable(id) && !own.has(id))) { use = 'fr'; own = fr; }
  const audio = segments.every(id => own.has(id) || fr.has(id));
  const lines = segments.map(id => ({
    id,
    // L'écran montre toujours le nom exact du médicament (MED_insuline couvre plusieurs insulines).
    text: replaceable(id) && id.startsWith('MED_') ? medicineLabel : (SEGMENT_TEXT[id] ?? ''),
    src: audio ? (own.get(id) ?? fr.get(id) ?? null) : null,
  })).filter(l => l.text !== '' || l.src !== null);
  return { lang: use, lines, audio };
}

/**
 * Alertes vocales de l'armoire familiale, comme sur l'app mobile : le serveur
 * renvoie des identifiants de segments, les fichiers audio sont servis par le site
 * (`public/audio/`, copie du pack de l'app) et joués l'un après l'autre.
 */
@Injectable({ providedIn: 'root' })
export class VoiceAlertService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Lecture en cours : article + type d'alerte, et ligne jouée (sous-titre). */
  readonly playing = signal<{ key: string; plan: VoicePlan; index: number } | null>(null);
  private player: HTMLAudioElement | null = null;
  private run = 0;

  private manifest$: Observable<AudioManifest> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** GET /cabinet/{id}/voice-alert (péremption) ou …/voice-alert/thermal (chaleur). */
  alert(itemId: number, kind: VoiceAlertKind): Observable<ApiVoiceAlert> {
    return this.http.get<ApiVoiceAlert>(`${this.base}/cabinet/${itemId}/voice-alert${kind === 'thermal' ? '/thermal' : ''}`);
  }

  /** PATCH /profile/location `{ preferred_language }` — langue des alertes vocales. */
  setLanguage(lang: VoiceLang): Observable<VoiceLang> {
    return this.http.patch<{ preferred_language?: VoiceLang | null }>(`${this.base}/profile/location`, { preferred_language: lang })
      .pipe(map(r => r.preferred_language ?? lang));
  }

  /** Manifest du pack audio, lu une seule fois (un échec est réessayé au prochain appel). */
  manifest(): Observable<AudioManifest> {
    // fetch, pas HttpClient : l'intercepteur joindrait le jeton à une requête vers l'hébergeur du site.
    this.manifest$ ??= from(fetch('audio/manifest.json').then(r => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      return r.json() as Promise<AudioManifest>;
    })).pipe(
      catchError(e => { this.manifest$ = null; return throwError(() => e); }),
      shareReplay(1),
    );
    return this.manifest$;
  }

  /**
   * Joue le message ligne par ligne (sous-titre = ligne en cours). Sans audio (règle 3),
   * tout le texte est affiché (`index` = -1) jusqu'à « Fermer ». Une seule lecture à la fois.
   */
  play(key: string, plan: VoicePlan): void {
    this.stop();
    const run = ++this.run;
    if (!plan.audio) { this.playing.set({ key, plan, index: -1 }); return; }
    this.playing.set({ key, plan, index: 0 });
    const next = (i: number) => {
      if (run !== this.run) return;
      if (i >= plan.lines.length) { this.playing.set(null); this.player = null; return; }
      this.playing.set({ key, plan, index: i });
      const src = plan.lines[i].src;
      if (!src) { next(i + 1); return; }
      const audio = new Audio(src);
      this.player = audio;
      audio.onended = () => next(i + 1);
      audio.onerror = () => next(i + 1); // fichier illisible : on passe, le texte reste lisible
      audio.play().catch(() => next(i + 1));
    };
    next(0);
  }

  stop(): void {
    this.run++;
    if (this.player) { this.player.pause(); this.player.onended = null; this.player.onerror = null; this.player = null; }
    this.playing.set(null);
  }
}
