import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiFloodReport, ApiFloodReportCreated, FloodSeverity } from '../../interfaces/api';
import { GeoPoint } from '../structures/structures';

/**
 * Signalements de routes inondées (`/flood-reports`, docs/api-inondations.md côté backend) :
 * anonymes, confirmés par plusieurs personnes, expirés après 6 h sans confirmation.
 * Les erreurs remontent à la page (écran « Réessayer », messages 409 / 422 / 429).
 */
@Injectable({ providedIn: 'root' })
export class FloodService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /flood-reports?lat=&lng=&radius= — non expirés, du plus proche au plus loin. */
  near(at: GeoPoint, radiusM: number): Observable<ApiFloodReport[]> {
    const params = new HttpParams().set('lat', at.lat.toFixed(5)).set('lng', at.lng.toFixed(5)).set('radius', String(radiusM));
    return this.http.get<{ data: ApiFloodReport[] }>(`${this.base}/flood-reports`, { params }).pipe(map(r => r.data ?? []));
  }

  /** POST /flood-reports — 201 nouveau, 200 `merged` (confirmation d'un signalement à moins de 200 m). */
  report(at: GeoPoint, severity: FloodSeverity): Observable<ApiFloodReportCreated> {
    return this.http.post<ApiFloodReportCreated>(`${this.base}/flood-reports`, { lat: at.lat, lng: at.lng, severity });
  }

  /** POST /flood-reports/{id}/confirm — position actuelle obligatoire (à moins de 200 m). */
  confirm(id: number, at: GeoPoint, severity?: FloodSeverity): Observable<ApiFloodReport> {
    return this.http.post<ApiFloodReport>(`${this.base}/flood-reports/${id}/confirm`, { lat: at.lat, lng: at.lng, ...(severity ? { severity } : {}) });
  }
}
