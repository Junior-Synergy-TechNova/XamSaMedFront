import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ApiCabinetItem, ApiErrorBody, ApiFamilyMember, ApiThermalStatus, CabinetItemPayload, FamilyRelationship,
} from '../../interfaces/api';

/** Statut thermique : le domicile doit être localisé avant toute comparaison météo. */
export type ThermalState =
  | { kind: 'ready'; status: ApiThermalStatus }
  | { kind: 'no-location'; message: string };

/**
 * Armoire familiale du patient (`/cabinet/*`) : médicaments gardés à la maison,
 * proches, statut thermique (météo du domicile) et localisation du domicile.
 * Les alertes vocales (`/cabinet/{id}/voice-alert`) sont dans `services/voice-alerts`
 * (segments du serveur joués avec le pack audio copié dans `public/audio/`).
 * Les erreurs de lecture remontent à la page (écran « Réessayer »), jamais une liste vide trompeuse.
 */
@Injectable({ providedIn: 'root' })
export class CabinetService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /cabinet — péremption la plus proche d'abord. */
  items(): Observable<ApiCabinetItem[]> {
    const params = new HttpParams().set('per_page', '100');
    return this.http.get<{ data: ApiCabinetItem[] }>(`${this.base}/cabinet`, { params }).pipe(map(r => r.data ?? []));
  }

  /** POST /cabinet */
  add(payload: CabinetItemPayload): Observable<ApiCabinetItem> {
    return this.http.post<ApiCabinetItem>(`${this.base}/cabinet`, payload);
  }

  /** PUT /cabinet/{id} */
  update(id: number, payload: CabinetItemPayload): Observable<ApiCabinetItem> {
    return this.http.put<ApiCabinetItem>(`${this.base}/cabinet/${id}`, payload);
  }

  /** DELETE /cabinet/{id} */
  remove(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/cabinet/${id}`);
  }

  /** POST /cabinet/{id}/open — ouvert aujourd'hui (ou à la date donnée). */
  markOpened(id: number, openedAt?: string): Observable<ApiCabinetItem> {
    return this.http.post<ApiCabinetItem>(`${this.base}/cabinet/${id}/open`, openedAt ? { opened_at: openedAt } : {});
  }

  /** GET /cabinet/members */
  members(): Observable<ApiFamilyMember[]> {
    return this.http.get<{ data: ApiFamilyMember[] }>(`${this.base}/cabinet/members`).pipe(map(r => r.data ?? []));
  }

  /** POST /cabinet/members */
  addMember(name: string, relationship: FamilyRelationship): Observable<ApiFamilyMember> {
    return this.http.post<ApiFamilyMember>(`${this.base}/cabinet/members`, { name, relationship });
  }

  /** PUT /cabinet/members/{id} */
  updateMember(id: number, name: string, relationship: FamilyRelationship): Observable<ApiFamilyMember> {
    return this.http.put<ApiFamilyMember>(`${this.base}/cabinet/members/${id}`, { name, relationship });
  }

  /** DELETE /cabinet/members/{id} — 409 tant que le proche a des médicaments. */
  removeMember(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/cabinet/members/${id}`);
  }

  /** GET /cabinet/thermal-status — 422 = domicile non localisé (état attendu, pas une erreur). */
  thermalStatus(): Observable<ThermalState> {
    return this.http.get<ApiThermalStatus>(`${this.base}/cabinet/thermal-status`).pipe(
      map(status => ({ kind: 'ready' as const, status })),
      catchError((e: HttpErrorResponse) => e.status === 422
        ? of({ kind: 'no-location' as const, message: (e.error as ApiErrorBody | null)?.message ?? 'Localisez votre domicile pour activer la surveillance thermique.' })
        : throwError(() => e)),
    );
  }

  /** PATCH /profile/location — position du domicile pour la météo. */
  saveHomeLocation(lat: number, lng: number): Observable<unknown> {
    return this.http.patch(`${this.base}/profile/location`, { home_lat: lat, home_lng: lng });
  }
}
