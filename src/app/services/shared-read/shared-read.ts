import { Observable, catchError, shareReplay, throwError } from 'rxjs';

/**
 * Âge maximal d'une lecture partagée entre la cloche et le premier affichage du tableau de bord.
 * Les actualisations après une action passent 0 : toujours un nouvel appel.
 */
export const SHARED_READ_MS = 30_000;

/**
 * Lecture HTTP partageable entre deux lecteurs proches dans le temps (la cloche et le
 * tableau de bord lisent la même liste à quelques centaines de ms d'écart).
 *
 * `get(maxAgeMs > 0)` réutilise la lecture précédente — réponse **ou requête encore en
 * cours** — si elle a moins de `maxAgeMs` et a été faite avec le même jeton `nova-token` :
 * un autre compte connecté entre-temps ne voit jamais les données du précédent.
 * `get(0)` (défaut, après une action) fait un nouvel appel, qui devient la lecture partagée.
 * Une erreur n'est jamais gardée : le lecteur suivant relance l'appel.
 */
export class SharedRead<T> {
  private last: { at: number; token: string | null; value$: Observable<T> } | null = null;

  constructor(private readonly fetch: () => Observable<T>) {}

  get(maxAgeMs = 0): Observable<T> {
    const token = readToken();
    const last = this.last;
    if (maxAgeMs > 0 && last && last.token === token && Date.now() - last.at <= maxAgeMs) return last.value$;

    const value$: Observable<T> = this.fetch().pipe(
      catchError((e: unknown) => {
        if (this.last?.value$ === value$) this.last = null;
        return throwError(() => e);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.last = { at: Date.now(), token, value$ };
    return value$;
  }
}

function readToken(): string | null {
  try { return localStorage.getItem('nova-token'); } catch { return null; }
}
