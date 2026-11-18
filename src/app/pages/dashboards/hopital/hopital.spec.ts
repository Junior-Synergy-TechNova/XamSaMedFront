import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HopitalDash } from './hopital';
import { PlatformState } from '../../../services/platform/platform';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;
const DOWN = { status: 0, statusText: 'Unknown Error' };

describe('HopitalDash — erreurs de lecture', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HopitalDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function create() {
    const fixture = TestBed.createComponent(HopitalDash);
    fixture.componentRef.setInput('section', 'home');
    await fixture.whenStable();
    return fixture;
  }

  it('alertes illisibles : écran « Réessayer », pas « aucune alerte »', async () => {
    const fixture = await create();
    http.expectOne(`${api}/hospital/alerts`).error(new ProgressEvent('error'), DOWN);
    await fixture.whenStable();

    const c = fixture.componentInstance;
    expect(c.alertsError()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Impossible de charger les alertes');

    c.retry();
    http.expectOne(`${api}/hospital/alerts`).flush({ data: [] });
    await fixture.whenStable();
    expect(c.alertsError()).toBe(false);
    expect(c.lastSync()).not.toBeNull();
  });

  it('donnée secondaire en échec : bandeau ambre nommant ce qui manque', async () => {
    const fixture = await create();
    http.expectOne(`${api}/hospital/alerts`).flush({ data: [] });
    http.expectOne(`${api}/hospital/stock`).error(new ProgressEvent('error'), DOWN);
    http.expectOne(`${api}/hospital/restock-requests`).flush({ data: [] });
    await fixture.whenStable();

    const c = fixture.componentInstance;
    expect([...c.failedLoads()]).toEqual(['stock de la pharmacie interne']);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain("Certaines données n'ont pas pu être chargées");
    expect(text).toContain('stock de la pharmacie interne');

    // Une action ne relit que ce qu'elle a changé, et une lecture réussie retire le bandeau.
    c.refresh('stock');
    http.expectOne(`${api}/hospital/stock`).flush({ data: [] });
    expect(c.failedLoads().size).toBe(0);
  });

  it('pastilles de la sidebar : alertes actives, lots périmés, critiques à traiter', async () => {
    const fixture = await create();
    http.expectOne(`${api}/hospital/alerts`).flush({ data: [
      { id: 1, medicine: 'Insuline', service: 'Urgences', severity: 'rupture', remaining_quantity: 0 },
      { id: 2, medicine: 'Morphine', service: 'Bloc', severity: 'tension', remaining_quantity: 3 },
    ] });
    http.expectOne(`${api}/hospital/stock`).flush({ data: [{ id: 5, medicine_name: 'Amoxicilline', expiry_level: 'expired' }] });
    http.expectOne(`${api}/hospital/critical-medicines`).flush({ data: [
      { medicine_id: 1, medicine: 'Insuline', available: 0, status: 'out_of_stock' },
      { medicine_id: 2, medicine: 'Morphine', available: 3, status: 'low' },
      { medicine_id: 3, medicine: 'Héparine', available: 40, status: 'available' },
    ] });
    await fixture.whenStable();
    expect(TestBed.inject(PlatformState).navCounts()).toEqual({ alert: 2, stock: 1, crit: 2 });

    fixture.destroy();
    expect(TestBed.inject(PlatformState).navCounts()).toBeNull();
  });
});
