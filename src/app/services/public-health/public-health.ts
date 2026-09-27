import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiControlledMedicine, ApiOverview, ApiReport, ApiTension, ApiTrends, ApiZone } from '../../interfaces/api';
import { Tension, ZoneInfo } from '../../interfaces/models';
import { toZoneInfo } from '../distributor/distributor';

const EMPTY_OVERVIEW: ApiOverview = { ruptures: 0, low: 0, zones_tracked: 0, medicines_in_tension: 0 };

/** Espace responsable santé publique : vue nationale, zones, tensions. */
@Injectable({ providedIn: 'root' })
export class PublicHealthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /public-health/overview */
  overview(): Observable<ApiOverview> {
    return this.http.get<{ data: ApiOverview }>(`${this.base}/public-health/overview`).pipe(
      map(r => r.data ?? EMPTY_OVERVIEW),
      catchError(() => of(EMPTY_OVERVIEW)),
    );
  }

  /** GET /public-health/zones */
  zones(): Observable<ZoneInfo[]> {
    return this.http.get<{ data: ApiZone[] }>(`${this.base}/public-health/zones`).pipe(
      map(r => r.data.map(z => toZoneInfo(z.name, z.level, z.ruptures))),
      catchError(() => of([])),
    );
  }

  /** GET /public-health/tension */
  tension(): Observable<Tension[]> {
    return this.http.get<{ data: ApiTension[] }>(`${this.base}/public-health/tension`).pipe(
      map(r => r.data.map(toTension)),
      catchError(() => of([])),
    );
  }

  /** GET /public-health/reports — liste des rapports générés. */
  reports(): Observable<ApiReport[]> {
    return this.http.get<{ data: ApiReport[] }>(`${this.base}/public-health/reports`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /public-health/reports/generate — national / régional / par médicament, sur une période. */
  generateReport(payload: { period: string; type: string; region?: string; medicine_id?: number }): Observable<ApiReport> {
    return this.http.post<{ data: ApiReport }>(`${this.base}/public-health/reports/generate`, payload).pipe(map(r => r.data));
  }

  /** GET /public-health/controlled — suivi spécial des médicaments contrôlés. */
  controlled(): Observable<ApiControlledMedicine[]> {
    return this.http.get<{ data: ApiControlledMedicine[] }>(`${this.base}/public-health/controlled`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /public-health/reports/{id}/download */
  downloadReport(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/public-health/reports/${id}/download`, {
      responseType: 'blob',
    });
  }

  /** GET /public-health/dashboard — indicateurs du tableau de bord. */
  dashboard(): Observable<Record<string, unknown>> {
    return this.http.get<{ data: Record<string, unknown> }>(`${this.base}/public-health/dashboard`).pipe(
      map(r => r.data ?? {}),
      catchError(() => of({})),
    );
  }

  /** GET /public-health/alerts — alertes nationales. */
  alerts(): Observable<Record<string, unknown>[]> {
    return this.http.get<{ data: Record<string, unknown>[] }>(`${this.base}/public-health/alerts`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /public-health/trends — ruptures / tensions quotidiennes sur 7 et 30 jours (historique réel). */
  trends(): Observable<ApiTrends | null> {
    return this.http.get<{ data: ApiTrends }>(`${this.base}/public-health/trends`).pipe(
      map(r => r.data ?? null),
      catchError(() => of(null)),
    );
  }

  /** GET /public-health/top-zones — top zones en tension. */
  topZones(): Observable<Record<string, unknown>[]> {
    return this.http.get<{ data: Record<string, unknown>[] }>(`${this.base}/public-health/top-zones`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }
}

function toTension(t: ApiTension): Tension {
  return {
    nom: t.medicine ?? '—',
    pct: t.pct,
    variation: t.variation ?? 0,
    score: t.score ?? t.pct,
    controlled: t.is_controlled ?? false,
    ruptures: t.ruptures ?? 0,
  };
}
