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

/** jsdom n'implémente pas matchMedia (HopitalDash le lit dès sa création : affichage téléphone). */
function stubMatchMedia(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe('HopitalDash — erreurs de lecture', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    stubMatchMedia(false);
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

describe('HopitalDash — recherche et filtres du stock', () => {
  const STOCK = [
    { id: 1, medicine_name: 'Paracétamol', form: 'comprimé', dosage: '500 mg', available: 120, threshold_qty: 20, alert_level: null, is_controlled: false, expiry_level: 'ok' },
    { id: 2, medicine_name: 'Héparine', form: 'injectable', dosage: '5000 UI', available: 4, threshold_qty: 10, alert_level: 'tension', is_controlled: false, expiry_level: 'ok' },
    { id: 3, medicine_name: 'Morphine', form: 'injectable', dosage: '10 mg', available: 0, threshold_qty: 5, alert_level: 'rupture', is_controlled: true, expiry_level: 'warn' },
  ];

  async function createStock(phone: boolean) {
    stubMatchMedia(phone);
    TestBed.configureTestingModule({
      imports: [HopitalDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    const fixture = TestBed.createComponent(HopitalDash);
    fixture.componentRef.setInput('section', 'stock');
    await fixture.whenStable();
    // L'écran attend la lecture des alertes avant d'afficher une section.
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${api}/hospital/alerts`).flush({ data: [] });
    http.expectOne(`${api}/hospital/stock`).flush({ data: STOCK });
    await fixture.whenStable();
    return fixture;
  }

  it('les plus urgentes en premier, recherche sans accents, nombre de lignes', async () => {
    const fixture = await createStock(false);
    const dash = fixture.componentInstance;
    expect(dash.filteredStock().map(s => s.id)).toEqual([3, 2, 1]);
    expect(dash.resultCountLabel()).toBe('3 lignes · les plus urgentes en premier');

    dash.stockQuery.set('heparine');
    await fixture.whenStable();
    expect(dash.filteredStock().map(s => s.id)).toEqual([2]);
    expect(dash.resultCountLabel()).toBe('1 ligne sur 3 · les plus urgentes en premier');
    expect(dash.activeStockFilters()[0]).toEqual({ key: 'query', label: '« heparine »' });

    dash.stockQuery.set('zzz');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.pf-td-empty').textContent).toContain('Aucun médicament ne correspond à « zzz »');
    dash.resetStockFilters();
    expect(dash.stockQuery()).toBe('');
    expect(dash.filteredStock().length).toBe(3);
  });

  it('ordinateur : tous les groupes visibles ; téléphone : Péremption et Réglementation sous « Autres filtres (n) »', async () => {
    const desktop = await createStock(false);
    const d: HTMLElement = desktop.nativeElement;
    expect(d.querySelector('.pf-morefilters')).toBeNull();
    expect(d.querySelectorAll('.pf-stockfilters .pf-fgroup').length).toBe(3);
    TestBed.resetTestingModule();

    const phone = await createStock(true);
    const p: HTMLElement = phone.nativeElement;
    const more = p.querySelector('details.pf-morefilters');
    expect(more).not.toBeNull();
    expect(more?.querySelectorAll('.pf-fgroup').length).toBe(2);
    expect(p.querySelector('#pf-hf-level')?.closest('details')).toBeNull();
    phone.componentInstance.controlledOnly.set(true);
    await phone.whenStable();
    expect(more?.querySelector('summary')?.textContent).toContain('Autres filtres (1)');
  });
});
