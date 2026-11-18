import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth';
import { PlatformState } from '../platform/platform';
import { ApiUser, BackendRole } from '../../interfaces/api';
import { RoleId } from '../../interfaces/models';
import { environment } from '../../../environments/environment';

const api = environment.apiUrl;

function user(role: BackendRole, over: Partial<ApiUser> = {}): ApiUser {
  return { id: 1, name: 'Test', email: 't@xamsamed.test', phone: null, role, structure_id: 3, structure: { id: 3, name: 'Pharmacie Centrale', type: 'pharmacy' } as ApiUser['structure'], ...over };
}

describe('AuthService — session Sanctum', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => localStorage.clear());

  it.each<[BackendRole, RoleId]>([
    ['patient', 'patient'], ['pharmacy_user', 'pharma'], ['distributor_user', 'distrib'], ['hospital_user', 'hopital'], ['admin', 'sante'],
  ])('login %s → espace %s, jeton et utilisateur persistés', (backend, space) => {
    const auth = TestBed.inject(AuthService);
    auth.login('t@xamsamed.test', 'secret-test').subscribe();
    const req = http.expectOne(`${api}/login`);
    expect(req.request.body).toEqual({ email: 't@xamsamed.test', password: 'secret-test' });
    req.flush({ user: user(backend), token: 'tok-1' });

    expect(auth.isAuthenticated()).toBe(true);
    expect(TestBed.inject(PlatformState).role()).toBe(space);
    expect(localStorage.getItem('nova-token')).toBe('tok-1');
    expect(JSON.parse(localStorage.getItem('nova-user') ?? '{}').role).toBe(backend);
    expect(auth.structure()?.name).toBe('Pharmacie Centrale');
  });

  it('restoreSession : un 401 efface la session, une panne réseau la garde', () => {
    localStorage.setItem('nova-token', 'tok-old');
    localStorage.setItem('nova-user', JSON.stringify(user('pharmacy_user')));
    const auth = TestBed.inject(AuthService);
    expect(TestBed.inject(PlatformState).role()).toBe('pharma'); // rétabli sans réseau

    auth.restoreSession();
    http.expectOne(`${api}/me`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(auth.isAuthenticated()).toBe(true);

    auth.restoreSession();
    http.expectOne(`${api}/me`).flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('nova-token')).toBeNull();
    expect(TestBed.inject(PlatformState).role()).toBeNull();
  });

  it('logout nettoie le client même si le serveur ne répond pas', () => {
    localStorage.setItem('nova-token', 'tok-old');
    const auth = TestBed.inject(AuthService);
    auth.logout().subscribe({ error: () => { /* attendu */ } });
    http.expectOne(`${api}/logout`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('nova-token')).toBeNull();
  });

  it('isPro suit l\'offre de la structure', () => {
    const auth = TestBed.inject(AuthService);
    auth.login('t@xamsamed.test', 'x').subscribe();
    http.expectOne(`${api}/login`).flush({ user: user('pharmacy_user', { structure: { id: 3, name: 'P', type: 'pharmacy', plan: 'pro' } as ApiUser['structure'] }), token: 't' });
    expect(auth.isPro()).toBe(true);
  });
});
