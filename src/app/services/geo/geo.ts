import { Injectable, signal } from '@angular/core';
import { GeoPoint } from '../structures/structures';

/** Raison d'un échec de localisation, pour un message utile à l'utilisateur. */
export type GeoFailure = 'unsupported' | 'denied' | 'unavailable';

/**
 * Position GPS du navigateur, partagée entre les écrans patient (classement des
 * pharmacies, carte des inondations). Rien n'est demandé tant que l'utilisateur
 * n'a pas appuyé sur un bouton « Utiliser ma position ». Gardée en mémoire seulement.
 */
@Injectable({ providedIn: 'root' })
export class GeoService {
  /** Dernière position connue (null tant que l'utilisateur ne l'a pas partagée). */
  readonly position = signal<GeoPoint | null>(null);
  readonly locating = signal(false);

  /**
   * Demande la position au navigateur. `fresh` exige une position actuelle
   * (confirmer une inondation : il faut être sur place), sinon une position
   * de moins de 5 minutes suffit.
   */
  locate(fresh = false): Promise<GeoPoint> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.reject<GeoPoint>('unsupported' satisfies GeoFailure);
    this.locating.set(true);
    return new Promise<GeoPoint>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          this.position.set(p);
          this.locating.set(false);
          resolve(p);
        },
        err => {
          this.locating.set(false);
          reject((err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable') satisfies GeoFailure);
        },
        { enableHighAccuracy: fresh, timeout: fresh ? 15000 : 10000, maximumAge: fresh ? 0 : 300000 },
      );
    });
  }

  /** Message à afficher après un échec de `locate()`. */
  static failureMessage(reason: unknown): string {
    return reason === 'denied' ? 'Position refusée : autorisez la localisation pour ce site dans votre navigateur.'
      : reason === 'unsupported' ? 'La localisation n\'est pas disponible sur cet appareil.'
      : 'Position introuvable pour le moment — réessayez à l\'extérieur ou dans quelques instants.';
  }
}
