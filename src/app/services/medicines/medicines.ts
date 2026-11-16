import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiAvailabilityResponse, ApiAvailabilityRow, ApiEquivalentsResponse, ApiGroupedSearchEquivalent, ApiMedicine, GlobalSearchResult } from '../../interfaces/api';
import { AvailabilityRow, DispoState, Med } from '../../interfaces/models';
import { GeoPoint, REF, haversineKm, kmLabel, toPoint } from '../structures/structures';

/** Équivalents d'un médicament, tels que le patient doit les voir. */
export interface EquivalentSet {
  /** Même DCI, classés par correspondance puis distance. */
  equivalents: ApiGroupedSearchEquivalent[];
  /** Autre molécule : jamais présentée comme un équivalent. */
  alternatives: ApiGroupedSearchEquivalent[];
  alternativesNotice: string;
  disclaimer: string;
  /** Rien dans le rayon : résultats élargis à tout le réseau. */
  widened: boolean;
}
const EMPTY_EQUIVALENTS: EquivalentSet = { equivalents: [], alternatives: [], alternativesNotice: '', disclaimer: '', widened: false };

/** Référentiel médicaments + disponibilité (recherche patient). */
@Injectable({ providedIn: 'root' })
export class MedicineService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /medicines?search= → Med[] (vue patient). */
  search(q: string): Observable<Med[]> {
    const searchParams = new HttpParams().set('search', q);
    return this.http.get<{ data: ApiMedicine[] }>(`${this.base}/medicines`, { params: searchParams }).pipe(
      map(r => (r.data ?? []).map(toMed)),
    );
  }

  /** GET /search?q= → médicaments et officines pour la recherche globale. */
  globalSearch(q: string): Observable<GlobalSearchResult[]> {
    const params = new HttpParams().set('q', q);
    return this.http.get<{ data: GlobalSearchResult[] }>(`${this.base}/search`, { params }).pipe(
      map(r => r.data ?? []),
    );
  }

  /** GET /medicines → catalogue complet (pour les listes déroulantes). */
  list(): Observable<{ id: number; name: string; label: string; dci: string | null }[]> {
    const params = new HttpParams().set('per_page', '200');
    return this.http.get<{ data: ApiMedicine[] }>(`${this.base}/medicines`, { params }).pipe(
      map(r => (r.data ?? []).map(m => ({
        id: Number(m.id),
        name: m.name,
        label: m.dosage ? `${m.name} — ${m.dosage}${m.form ? ' (' + m.form + ')' : ''}` : m.name,
        dci: m.dci?.trim() || null,
      }))),
      catchError(() => of([])),
    );
  }

  /**
   * GET /medicines/{id}/equivalents → équivalents thérapeutiques classés par
   * pertinence (même DCI, classe ATC, forme, dosage) et disponibilité réelle.
   */
  equivalents(medId: number): Observable<ApiGroupedSearchEquivalent[]> {
    return this.equivalentSet(medId).pipe(map(s => s.equivalents));
  }

  /**
   * Réponse complète de `/equivalents` : équivalents de même DCI (avec leurs
   * avertissements), alternatives d'une autre molécule — à présenter à part,
   * toujours « à valider » — et le message de prudence fourni par l'API.
   * Position = `at` si connue, sinon le point de référence (Dakar Plateau).
   */
  equivalentSet(medId: number, at?: GeoPoint | null): Observable<EquivalentSet> {
    const from = at ?? REF;
    const params = new HttpParams().set('lat', String(from.lat)).set('lng', String(from.lng));
    return this.http.get<ApiEquivalentsResponse>(`${this.base}/medicines/${medId}/equivalents`, { params }).pipe(
      map(r => ({
        equivalents: r.data ?? [],
        alternatives: r.alternatives?.data ?? [],
        alternativesNotice: r.alternatives?.notice ?? 'Molécule différente : à valider obligatoirement par un médecin ou un pharmacien.',
        disclaimer: r.disclaimer ?? "La substitution d'un médicament doit se faire uniquement avec l'avis de votre pharmacien.",
        widened: r.fallback === true,
      })),
      catchError(() => of(EMPTY_EQUIVALENTS)),
    );
  }

  /** GET /medicines/{id}/availability → points de disponibilité (officines). */
  availability(medId: number): Observable<AvailabilityRow[]> {
    return this.http.get<{ data: ApiAvailabilityRow[] }>(`${this.base}/medicines/${medId}/availability`).pipe(
      map(r => (r.data ?? []).map(toAvailabilityRow)),
    );
  }

  /**
   * GET /medicines/{id}/availability?sort=score — classement par score d'accessibilité
   * (disponibilité, fraîcheur du stock, distance, inondations confirmées). Sans `from`,
   * l'API prend le domicile enregistré ; sans domicile, `position_source` est null et le score aussi.
   */
  rankedAvailability(medId: number, from: GeoPoint | null, qty = 1): Observable<{ rows: AvailabilityRow[]; positionSource: 'gps' | 'home' | null }> {
    let params = new HttpParams().set('sort', 'score').set('qty', String(qty));
    if (from) params = params.set('lat', from.lat.toFixed(5)).set('lng', from.lng.toFixed(5));
    return this.http.get<ApiAvailabilityResponse>(`${this.base}/medicines/${medId}/availability`, { params }).pipe(
      map(r => ({ rows: (r.data ?? []).map(toAvailabilityRow), positionSource: r.position_source ?? null })),
    );
  }
}

export function toMed(m: ApiMedicine): Med {
  return {
    id: String(m.id),
    nom: m.dosage ? `${m.name} ${m.dosage}` : m.name,
    dci: m.brand ?? m.name,
    forme: m.form ?? '',
    crit: m.is_controlled,
    cat: m.is_controlled ? 'Médicament contrôlé' : 'Médicament',
  };
}

function toDispoState(status: string): DispoState {
  return status === 'out_of_stock' ? 'out' : status === 'low' ? 'low' : 'ok';
}

function toAvailabilityRow(r: ApiAvailabilityRow): AvailabilityRow {
  const p = toPoint(r.latitude, r.longitude);
  // Distance fournie par l'API (appel géolocalisé) sinon calculée depuis la
  // position de référence ; les coordonnées brutes restent disponibles pour un
  // recalcul depuis un autre point (officine qui oriente, par exemple).
  const metres = Number(r.distance_metres);
  const km = isFinite(metres) && r.distance_metres !== null && r.distance_metres !== undefined
    ? metres / 1000
    : p ? haversineKm(REF, p) : null;
  return {
    structureId: r.structure_id,
    pharmacy: r.pharmacy_name ?? r.pharmacy ?? '—',
    city: r.city ?? '',
    phone: r.phone ?? '',
    lat: p?.lat ?? null,
    lng: p?.lng ?? null,
    distKm: km,
    dist: r.distance_label ?? kmLabel(km),
    s: toDispoState(r.status),
    label: r.label,
    available: Number(r.available ?? 0),
    score: typeof r.score === 'number' ? r.score : null,
    reasons: r.reasons ?? [],
  };
}
