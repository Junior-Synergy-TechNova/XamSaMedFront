import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PharmacyService, SALES_PER_PAGE, SalesPage } from './pharmacy';
import { environment } from '../../../environments/environment';

describe('PharmacyService.salesPage', () => {
  let http: HttpTestingController;
  let service: PharmacyService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(PharmacyService);
  });

  afterEach(() => http.verify());

  it('envoie la période et la page, et lit la pagination du backend', () => {
    let page: SalesPage | undefined;
    service.salesPage('2026-10-01', '2026-10-31', 2).subscribe(p => page = p);
    const req = http.expectOne(r => r.url === `${environment.apiUrl}/pharmacy/sales`);
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('per_page')).toBe(String(SALES_PER_PAGE));
    req.flush({ data: [], pagination: { total: 120, current_page: 2, last_page: 3 } });
    expect(page).toEqual({ data: [], page: 2, lastPage: 3, total: 120 });
  });

  it('laisse remonter les erreurs (la vue affiche « Réessayer »)', () => {
    let failed = false;
    service.salesPage(null, null).subscribe({ error: () => failed = true });
    http.expectOne(r => r.url === `${environment.apiUrl}/pharmacy/sales`).flush({}, { status: 500, statusText: 'Error' });
    expect(failed).toBe(true);
  });
});
