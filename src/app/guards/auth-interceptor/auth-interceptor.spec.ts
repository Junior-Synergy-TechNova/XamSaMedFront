import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth-interceptor';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });
  afterEach(() => localStorage.clear());

  it('ajoute Accept JSON et le jeton Bearer quand une session existe', () => {
    localStorage.setItem('nova-token', 'tok-42');
    client.get('/api/me').subscribe();
    const req = http.expectOne('/api/me');
    expect(req.request.headers.get('Accept')).toBe('application/json');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-42');
    req.flush({});
  });

  it('sans session : Accept seulement, aucun en-tête Authorization', () => {
    client.get('/api/medicines').subscribe();
    const req = http.expectOne('/api/medicines');
    expect(req.request.headers.get('Accept')).toBe('application/json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});
