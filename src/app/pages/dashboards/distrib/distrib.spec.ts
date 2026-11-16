import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { DistribDash } from './distrib';
import { PlatformState } from '../../../services/platform/platform';
import { ApiIncomingRequest } from '../../../interfaces/api';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;
const DOWN = { status: 0, statusText: 'Unknown Error' };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function request(over: Partial<ApiIncomingRequest>): ApiIncomingRequest {
  return {
    id: 1, kind: 'pharmacy', structure_id: 10, structure: 'Pharmacie du Port', medicine_id: 5, medicine: 'Amoxicilline',
    available: 2, threshold: 10, quantity_requested: 50, service: null, message: null, is_controlled: false,
    targeted: true, status: 'pending', delivery_id: null, delivery_date: null, rejection_reason: null,
    created_at: daysAgo(0), reminders: 0, ...over,
  };
}

describe('DistribDash — demandes reçues', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [DistribDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function create() {
    const fixture = TestBed.createComponent(DistribDash);
    fixture.componentRef.setInput('section', 'home');
    await fixture.whenStable();
    return fixture;
  }
  const one = (path: string): TestRequest => http.expectOne(r => r.url === `${api}${path}`);

  it('demandes illisibles : écran « Réessayer », pas « aucune demande »', async () => {
    const fixture = await create();
    one('/distributor/requests').error(new ProgressEvent('error'), DOWN);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    expect(c.requestsError()).toBe(true);

    c.retry();
    one('/distributor/requests').flush({ data: [] });
    await fixture.whenStable();
    expect(c.requestsError()).toBe(false);
  });

  it('liste de travail : contrôlé ou relancé d\'abord, puis ≥ 3 jours, puis le reste ; pastille = demandes en attente', async () => {
    const fixture = await create();
    one('/distributor/requests').flush({ data: [
      request({ id: 1, created_at: daysAgo(0) }),
      request({ id: 2, created_at: daysAgo(4) }),
      request({ id: 3, is_controlled: true, medicine: 'Morphine' }),
      request({ id: 4, reminders: 1 }),
      request({ id: 5, status: 'resolved' }),
    ] });
    await fixture.whenStable();
    const c = fixture.componentInstance;

    const reqs = c.todo().filter(t => t.key.startsWith('req-')).map(t => t.key);
    expect(reqs.slice(0, 2).sort()).toEqual(['req-3', 'req-4']);
    expect(reqs.slice(2)).toEqual(['req-2', 'req-1']);
    expect(c.todo().find(t => t.key === 'req-5')).toBeUndefined();
    expect(TestBed.inject(PlatformState).navCounts()?.['reg']).toBe(4);

    fixture.destroy();
    expect(TestBed.inject(PlatformState).navCounts()).toBeNull();
  });

  it('donnée secondaire en échec : bandeau qui la nomme', async () => {
    const fixture = await create();
    one('/distributor/requests').flush({ data: [] });
    one('/distributor/previsions').error(new ProgressEvent('error'), DOWN);
    await fixture.whenStable();
    expect([...fixture.componentInstance.failedLoads()]).toContain('prévisions');
  });
});
