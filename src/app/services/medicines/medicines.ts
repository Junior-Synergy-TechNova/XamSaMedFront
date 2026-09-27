import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiAvailabilityRow, ApiGroupedSearchEquivalent, ApiMedicine, GlobalSearchResult } from '../../interfaces/api';
import { AvailabilityRow, DispoState, Med } from '../../interfaces/models';
import { REF, haversineKm, kmLabel, toPoint } from '../structures/structures';

/** Référentiel médicaments + disponibilité (recherche patient). */
@Injectable({ providedIn: 'root' })
export class MedicineService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /medicines?search= → Med[] (vue patient). */
  search(q: string): Observable<Med[]> {
    const searchParams = new HttpParams().set('search', q);
    return this.http.get<{ data: ApiMedicine[] }>(`${this.base}/medicines`, { params: searchParams }).pipe(
      map(r => r.data.map(toMed)),
      catchError(() => of([])),
    );
  }

  /** GET /search?q= → médicaments et officines pour la recherche globale. */
  globalSearch(q: string): Observable<GlobalSearchResult[]> {
    const params = new HttpParams().set('q', q);
    return this.http.get<{ data: GlobalSearchResult[] }>(`${this.base}/search`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /medicines → catalogue complet (pour les listes déroulantes). */
  list(): Observable<{ id: number; name: string; label: string }[]> {
    const params = new HttpParams().set('per_page', '200');
    return this.http.get<{ data: ApiMedicine[] }>(`${this.base}/medicines`, { params }).pipe(
      map(r => (r.data ?? []).map(m => ({
        id: Number(m.id),
        name: m.name,
        label: m.dosage ? `${m.name} — ${m.dosage}${m.form ? ' (' + m.form + ')' : ''}` : m.name,
      }))),
      catchError(() => of([])),
    );
  }

  /**
   * GET /medicines/{id}/equivalents → équivalents thérapeutiques classés par
   * pertinence (même DCI, classe ATC, forme, dosage) et disponibilité réelle.
   */
  equivalents(medId: number): Observable<ApiGroupedSearchEquivalent[]> {
    const params = new HttpParams().set('lat', String(REF.lat)).set('lng', String(REF.lng));
    return this.http.get<{ data: ApiGroupedSearchEquivalent[] }>(`${this.base}/medicines/${medId}/equivalents`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /medicines/{id}/availability → points de disponibilité (officines). */
  availability(medId: number): Observable<AvailabilityRow[]> {
    return this.http.get<{ data: ApiAvailabilityRow[] }>(`${this.base}/medicines/${medId}/availability`).pipe(
      map(r => r.data.map(toAvailabilityRow)),
      catchError(() => of([])),
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
  };
}
