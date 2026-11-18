import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { PharmacyService, SALES_PER_PAGE, SHARED_READ_MS, SalesPage } from './pharmacy';
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

const url = `${environment.apiUrl}/pharmacy/demandes`;
const demande = { id: 7, medicine_id: 3, medicine: 'Amoxicilline', patient: 'A. Diop', qty: 2, type: 'reservation', urgency: 'normal', status: 'pending', created_at: '2026-11-15T10:00:00Z' };

/**
 * GET /pharmacy/demandes est lu par la cloche (NotificationService) et par le tableau de bord
 * pharmacien au même moment : la lecture est partagée, sans jamais servir des données d'un
 * autre compte ni une erreur, et les actualisations après une action restent fraîches.
 */
describe('PharmacyService.demandes — lecture partagée', () => {
  let http: HttpTestingController;
  let service: PharmacyService;

  beforeEach(() => {
    localStorage.setItem('nova-token', 'tok-A');
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(PharmacyService);
  });

  afterEach(() => { http.verify(); localStorage.removeItem('nova-token'); });

  it('cloche + premier affichage : un seul appel, même pendant la requête', async () => {
    const bell = firstValueFrom(service.demandes(SHARED_READ_MS));
    const dashboard = firstValueFrom(service.demandes(SHARED_READ_MS));
    http.expectOne(url).flush({ data: [demande] });
    expect((await bell).length).toBe(1);
    expect((await dashboard).length).toBe(1);
    // Réponse déjà reçue et récente : toujours pas de nouvel appel.
    expect((await firstValueFrom(service.demandes(SHARED_READ_MS))).length).toBe(1);
  });

  it('après une action (maxAge 0) : nouvel appel, qui devient la lecture partagée', async () => {
    const first = firstValueFrom(service.demandes(SHARED_READ_MS));
    http.expectOne(url).flush({ data: [demande] });
    await first;
    const fresh = firstValueFrom(service.demandes());
    http.expectOne(url).flush({ data: [] });
    expect((await fresh).length).toBe(0);
    expect((await firstValueFrom(service.demandes(SHARED_READ_MS))).length).toBe(0);
  });

  it('autre compte connecté : jamais les demandes du précédent', async () => {
    const a = firstValueFrom(service.demandes(SHARED_READ_MS));
    http.expectOne(url).flush({ data: [demande] });
    await a;
    localStorage.setItem('nova-token', 'tok-B');
    const b = firstValueFrom(service.demandes(SHARED_READ_MS));
    http.expectOne(url).flush({ data: [] });
    expect((await b).length).toBe(0);
  });

  it('une erreur n\'est pas gardée : la lecture suivante rappelle l\'API', async () => {
    const failed = firstValueFrom(service.demandes(SHARED_READ_MS));
    http.expectOne(url).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await expect(failed).rejects.toBeTruthy();
    const retry = firstValueFrom(service.demandes(SHARED_READ_MS));
    http.expectOne(url).flush({ data: [demande] });
    expect((await retry).length).toBe(1);
  });
});
