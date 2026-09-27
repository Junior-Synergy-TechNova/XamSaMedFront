import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiAdminUser, ApiMedicine, ApiStructure } from '../../interfaces/api';

/** Administration (réservé au rôle admin) : utilisateurs + structures. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // ── Utilisateurs ──────────────────────────────────────────────
  /** GET /admin/users */
  users(): Observable<ApiAdminUser[]> {
    return this.http.get<{ data: ApiAdminUser[] }>(`${this.base}/admin/users`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /admin/users (mot de passe auto-généré + envoyé par email). */
  createUser(payload: { name: string; email: string; phone?: string; role: string; structure_id?: number | null }): Observable<unknown> {
    return this.http.post(`${this.base}/admin/users`, payload);
  }

  /** DELETE /admin/users/{id} (soft delete). */
  deleteUser(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/admin/users/${id}`);
  }

  // ── Catalogue national des médicaments ───────────────────────
  /** GET /medicines — catalogue complet (ordonnance, catégorie, contrôlé). */
  medicines(): Observable<ApiMedicine[]> {
    const params = new HttpParams().set('per_page', '500');
    return this.http.get<{ data: ApiMedicine[] }>(`${this.base}/medicines`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** PUT /admin/medicines/{id} — ex. rendre un médicament « sur ordonnance » ou en vente libre. */
  updateMedicine(id: number, payload: { requires_prescription?: boolean; category?: string; is_controlled?: boolean }): Observable<unknown> {
    return this.http.put(`${this.base}/admin/medicines/${id}`, payload);
  }

  // ── Structures ────────────────────────────────────────────────
  /** GET /structures (actives). */
  structures(): Observable<ApiStructure[]> {
    return this.http.get<{ data: ApiStructure[] }>(`${this.base}/structures`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /admin/structures */
  createStructure(payload: { name: string; type: string; sector?: string; plan?: string; city?: string; region?: string; contact_phone?: string; code?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/admin/structures`, payload);
  }

  /** PUT /admin/structures/{id} — ex. changer l'offre (Starter / Pro) ou le secteur d'un hôpital. */
  updateStructure(id: number, payload: { plan?: string; sector?: string }): Observable<unknown> {
    return this.http.put(`${this.base}/admin/structures/${id}`, payload);
  }

  /** DELETE /admin/structures/{id} (désactivation). */
  deleteStructure(id: number): Observable<unknown> {
    return this.http.delete(`${this.base}/admin/structures/${id}`);
  }
}
