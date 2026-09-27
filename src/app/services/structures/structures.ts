import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiStructure, ApiSupplier } from '../../interfaces/api';
import { Pharmacy } from '../../interfaces/models';

/** Point géographique (degrés décimaux). */
export interface GeoPoint { lat: number; lng: number }

/** Dakar Plateau — position de référence par défaut (patient de démo). */
export const REF: GeoPoint = { lat: 14.6928, lng: -17.4467 };

/** Coordonnées exploitables, ou null si l'une des deux manque / est invalide. */
export function toPoint(lat: number | string | null | undefined, lng: number | string | null | undefined): GeoPoint | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  if (!isFinite(la) || !isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

/** Position de la structure de l'utilisateur connecté (null si non géolocalisée). */
export function structurePoint(s: { latitude?: number | string | null; longitude?: number | string | null } | null | undefined): GeoPoint | null {
  return s ? toPoint(s.latitude, s.longitude) : null;
}

/** Distance à vol d'oiseau (Haversine) entre deux points, en km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance depuis la position de référence par défaut, en km. */
export function distanceKm(lat: number, lng: number): number {
  return haversineKm(REF, { lat, lng });
}

/**
 * Libellé d'une distance (« 9,2 km », « 850 m », « < 100 m »), « — » si
 * inconnue. En dessous du kilomètre on passe en mètres : « 0,0 km » ne
 * distinguait pas une officine voisine d'une distance non calculée.
 */
export function kmLabel(km: number | null): string {
  if (km === null) return '—';
  if (km < 0.1) return '< 100 m';
  if (km < 1) return Math.round(km * 1000) + ' m';
  return km.toFixed(1).replace('.', ',') + ' km';
}

export function distanceLabel(lat: number | string | null, lng: number | string | null): string {
  const p = toPoint(lat, lng);
  return kmLabel(p ? haversineKm(REF, p) : null);
}

/**
 * Recalcule la distance de chaque ligne depuis `from` (si fourni) puis trie du
 * plus proche au plus loin — les lignes sans coordonnées ferment la liste.
 * `from` null : conserve les distances déjà calculées et se contente de trier.
 */
export function rankByDistance<T extends { lat: number | null; lng: number | null; distKm: number | null; dist: string }>(
  rows: readonly T[],
  from: GeoPoint | null,
): T[] {
  const withDist = rows.map(r => {
    if (!from) return r;
    const p = toPoint(r.lat, r.lng);
    const km = p ? haversineKm(from, p) : null;
    return { ...r, distKm: km, dist: kmLabel(km) };
  });
  return withDist.sort((a, b) => (a.distKm ?? Infinity) - (b.distKm ?? Infinity));
}

/** Projette des coordonnées géographiques (région de Dakar) dans une boîte 0–100 % pour la mini-carte. */
export function projectToBox(lat: number | string | null, lng: number | string | null): { x: number; y: number } {
  const la = Number(lat);
  const ln = Number(lng);
  const LAT_MIN = 14.4, LAT_MAX = 16.2, LNG_MIN = -17.65, LNG_MAX = -16.0;
  const clamp = (v: number) => Math.max(4, Math.min(96, v));
  const x = isFinite(ln) ? ((ln - LNG_MIN) / (LNG_MAX - LNG_MIN)) * 100 : 50;
  const y = isFinite(la) ? ((LAT_MAX - la) / (LAT_MAX - LAT_MIN)) * 100 : 50;
  return { x: clamp(x), y: clamp(y) };
}

/** Accès aux structures (pharmacies / hôpitaux / distributeurs). */
@Injectable({ providedIn: 'root' })
export class StructureService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /pharmacies → Pharmacy[] (lat/lng projetés en % pour la carte, dist = Haversine). */
  pharmacies(): Observable<Pharmacy[]> {
    return this.http.get<{ data: ApiStructure[] }>(`${this.base}/pharmacies`).pipe(
      map(r => r.data.map(toPharmacy)),
      catchError(() => of([])),
    );
  }

  /**
   * GET /distributors?medicine_id= → fournisseurs (distributeurs privés + PRA)
   * avec, pour le médicament donné, leur quantité disponible lue en base et le
   * flag partenaire. Sert au choix « à qui envoyer la demande ».
   */
  suppliers(medicineId?: number | null): Observable<ApiSupplier[]> {
    let params = new HttpParams();
    if (medicineId) params = params.set('medicine_id', String(medicineId));
    return this.http.get<{ data: ApiSupplier[] }>(`${this.base}/distributors`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }
}

function toPharmacy(s: ApiStructure): Pharmacy {
  const p = projectToBox(s.latitude, s.longitude);
  return {
    id: String(s.id),
    nom: s.name,
    ville: s.city ?? '',
    dist: distanceLabel(s.latitude, s.longitude),
    tel: s.phone ?? '',
    horaires: s.hours ?? '',
    lat: p.y, // top %
    lng: p.x, // left %
  };
}
