import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiPartner, ApiPartnerCandidate } from '../../interfaces/api';

/**
 * Réseau de partenaires commun aux officines, hôpitaux et fournisseurs
 * (GET/POST/PATCH/DELETE /partners). La séparation public ↔ privé est
 * appliquée par le backend : seules les structures connectables sont proposées.
 */
@Injectable({ providedIn: 'root' })
export class PartnerService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /partners — partenariats initiés + invitations reçues. */
  list(): Observable<ApiPartner[]> {
    return this.http.get<{ data: ApiPartner[] }>(`${this.base}/partners`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /partners/search?q=&type= — structures connectables selon les règles de la chaîne. */
  search(q: string, type?: string): Observable<ApiPartnerCandidate[]> {
    let params = new HttpParams().set('q', q);
    if (type) params = params.set('type', type);
    return this.http.get<{ data: ApiPartnerCandidate[] }>(`${this.base}/partners/search`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /partners — invitation par sélection (id) ou par email / code structure. */
  invite(target: { partner_id?: number; identifier?: string }): Observable<{ status: string; partner: string }> {
    return this.http.post<{ status: string; partner: string }>(`${this.base}/partners`, target);
  }

  /** PATCH /partners/{id} — accepter une invitation reçue. */
  accept(id: number): Observable<unknown> {
    return this.http.patch(`${this.base}/partners/${id}`, { status: 'active' });
  }

  /** PATCH /partners/{id} — rejeter une invitation reçue. */
  reject(id: number): Observable<unknown> {
    return this.http.patch(`${this.base}/partners/${id}`, { status: 'rejected' });
  }

  /** DELETE /partners/{id} — rompre un partenariat. */
  remove(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/partners/${id}`);
  }
}
