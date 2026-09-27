import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, map, tap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { PlatformState } from '../platform/platform';
import { RoleId } from '../../interfaces/models';
import { ApiUser, ApiUserStructure, BackendRole, LoginResponse, OtpChannel, OtpRequestResponse } from '../../interfaces/api';

const TOKEN_KEY = 'nova-token';
const USER_KEY = 'nova-user';

/** Correspondance rôle backend Laravel → espace NOVAmedacces. */
const ROLE_MAP: Record<BackendRole, RoleId> = {
  patient: 'patient',
  pharmacy_user: 'pharma',
  distributor_user: 'distrib',
  hospital_user: 'hopital',
  admin: 'sante',
};

/* ============================================================
   Authentification Sanctum (login / me / logout) + session.
   ============================================================ */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformState);
  private readonly base = environment.apiUrl;

  readonly user = signal<ApiUser | null>(this.restoreUser());
  readonly token = signal<string | null>(this.restoreToken());
  readonly isAuthenticated = computed(() => this.token() !== null);
  /** Structure de l'utilisateur (type, secteur, offre) — lue en base via /login et /me. */
  readonly structure = computed<ApiUserStructure | null>(() => this.user()?.structure ?? null);
  /** Offre Pro souscrite (module Vente & Comptabilité). */
  readonly isPro = computed(() => this.structure()?.plan === 'pro');

  constructor() {
    // Réaligne le rôle d'espace à partir de la session persistée (sans réseau).
    const u = this.user();
    if (u) this.platform.setRole(ROLE_MAP[u.role]);
  }

  /** POST /login → stocke le token + l'utilisateur et fixe le rôle d'espace. */
  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/login`, { email, password })
      .pipe(tap(res => this.apply(res.user, res.token)));
  }

  /** POST /login/otp/request → envoie un code à usage unique (email, SMS ou WhatsApp). */
  requestOtp(identifier: string, channel: OtpChannel): Observable<OtpRequestResponse> {
    return this.http.post<OtpRequestResponse>(`${this.base}/login/otp/request`, { identifier, channel });
  }

  /** POST /login/otp/verify → ouvre la session comme /login. */
  verifyOtp(identifier: string, code: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.base}/login/otp/verify`, { identifier, code })
      .pipe(tap(res => this.apply(res.user, res.token)));
  }

  /** GET /me → rafraîchit le profil courant (et valide le token). */
  me(): Observable<ApiUser> {
    return this.http.get<ApiUser>(`${this.base}/me`).pipe(tap(user => {
      this.user.set(user);
      this.persistUser(user);
      this.platform.setRole(ROLE_MAP[user.role]);
    }));
  }

  /** PUT /me → met à jour le profil et rafraîchit la session locale. */
  updateProfile(payload: { name?: string; phone?: string; email?: string }): Observable<ApiUser> {
    return this.http.put<{ status: string; user: ApiUser }>(`${this.base}/me`, payload).pipe(
      map(r => r.user),
      tap(user => { this.user.set(user); this.persistUser(user); }),
    );
  }

  /** PUT /me/password → change le mot de passe (vérifie l'actuel côté serveur). */
  updatePassword(currentPassword: string, password: string): Observable<unknown> {
    return this.http.put(`${this.base}/me/password`, {
      current_password: currentPassword,
      password,
      password_confirmation: password,
    });
  }

  /** POST /forgot-password → envoie un code de réinitialisation. */
  forgotPassword(email: string): Observable<{ status: string; message: string; debug_code?: string }> {
    return this.http.post<{ status: string; message: string; debug_code?: string }>(`${this.base}/forgot-password`, { email });
  }

  /** POST /reset-password → réinitialise le mot de passe avec le code reçu. */
  resetPassword(email: string, token: string, password: string): Observable<unknown> {
    return this.http.post(`${this.base}/reset-password`, { email, token, password, password_confirmation: password });
  }

  /** POST /logout → révoque le token côté serveur puis nettoie le client. */
  logout(): Observable<unknown> {
    return this.http.post(`${this.base}/logout`, {}).pipe(finalize(() => this.clear()));
  }

  /** Au démarrage : valide la session persistée si un token existe (best-effort). */
  restoreSession(): void {
    if (this.token()) {
      this.me().subscribe({
        error: (error: HttpErrorResponse) => {
          // Un 401 invalide la session persistée; les erreurs réseau restent tolérées.
          if (error.status === 401) this.clear();
        },
      });
    }
  }

  roleIdFor(role: BackendRole): RoleId { return ROLE_MAP[role]; }

  private apply(user: ApiUser, token: string): void {
    this.token.set(token);
    this.user.set(user);
    this.persistToken(token);
    this.persistUser(user);
    this.platform.setRole(ROLE_MAP[user.role]);
  }

  private clear(): void {
    this.token.set(null);
    this.user.set(null);
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
    this.platform.clearRole();
  }

  private persistToken(t: string): void { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } }
  private persistUser(u: ApiUser): void { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ } }
  private restoreToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
  private restoreUser(): ApiUser | null {
    try { const v = localStorage.getItem(USER_KEY); return v ? (JSON.parse(v) as ApiUser) : null; } catch { return null; }
  }
}


