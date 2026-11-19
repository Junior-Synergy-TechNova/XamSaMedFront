import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PharmaDash } from './pharma';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;

describe('PharmaDash — ordonnances et ventes', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    // jsdom n'implémente pas matchMedia (PharmaDash le lit dès sa création : affichage téléphone).
    window.matchMedia ??= ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    TestBed.configureTestingModule({
      imports: [PharmaDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('signalée en ambre dans « À traiter maintenant » et dans la fenêtre « Traiter », sans bloquer', async () => {
    const fixture = TestBed.createComponent(PharmaDash);
    fixture.componentRef.setInput('section', 'home');
    await fixture.whenStable();
    http.match(r => r.url === `${api}/pharmacy/stock`).forEach(r => r.flush({ data: [] }));
    http.match(r => r.url === `${api}/pharmacy/prescriptions`).forEach(r => r.flush({ data: [
      { id: 41, patient: 'Awa Diop', phone: null, notes: null, status: 'pending', submitted_at: '2026-11-14T10:00:00Z', photo_deja_envoyee: 2, rappel_controle: "Vérifiez l'ordonnance originale (signature, date) au retrait." },
      { id: 42, patient: 'Moussa Fall', phone: null, notes: null, status: 'pending', submitted_at: '2026-11-14T11:00:00Z', photo_deja_envoyee: 0 },
    ] }));
    await fixture.whenStable();

    const c = fixture.componentInstance;
    const reused = c.todo().find(t => t.key === 'ordo-41');
    const fresh = c.todo().find(t => t.key === 'ordo-42');
    expect(reused?.tone).toBe('amber');
    expect(reused?.detail).toContain('même photo déjà envoyée 2 autres fois');
    expect(reused?.action).toBe('Traiter');
    expect(fresh?.tone).toBe('blue');
    expect(fresh?.detail).not.toContain('même photo');

    reused?.run();
    await fixture.whenStable();
    const modal = (fixture.nativeElement as HTMLElement).querySelector('.pf-modal .pf-ordo-reuse');
    expect(modal?.textContent).toContain('Même photo déjà envoyée 2 autres fois');
    expect(modal?.textContent).toContain("Vérifiez l'ordonnance originale");
  });

  it('vente : prix repris du catalogue, puis formulaire remis à vide après « Ajouter »', async () => {
    const fixture = TestBed.createComponent(PharmaDash);
    fixture.componentRef.setInput('section', 'home');
    await fixture.whenStable();
    const row = (id: number, name: string, price: number | null) => ({
      id, medicine_id: id, medicine_name: name, form: 'comprimé', dosage: '500mg', price, is_controlled: false,
      quantity: 20, reserved: 0, available: 20, threshold_qty: 5, status: 'available', requires_prescription: false,
    });
    http.match(r => r.url === `${api}/pharmacy/stock`).forEach(r => r.flush({ data: [row(1, 'Paracétamol', 500), row(2, 'Ibuprofène', null)] }));
    await fixture.whenStable();
    const c = fixture.componentInstance;

    c.saleStockId.set(1);
    expect(c.salePriceLocked()).toBe(true);
    c.saleQty.set('3');
    c.addToCart('1', '3', '1'); // le prix tapé est ignoré : catalogue
    expect(c.cart()).toEqual([expect.objectContaining({ stockId: 1, qty: 3, price: 500 })]);
    expect(c.saleItem()).toBeNull();
    expect(c.saleQty()).toBe('1');

    c.saleStockId.set(2);
    expect(c.salePriceLocked()).toBe(false);
    c.addToCart('2', '1', '');
    expect(c.cart().length).toBe(1); // sans prix catalogue, la saisie est exigée
    c.addToCart('2', '2', '750');
    expect(c.cart()[1]).toEqual(expect.objectContaining({ stockId: 2, qty: 2, price: 750 }));
    expect(c.salePriceInput()).toBe('');
  });

  it("alerte groupée : « J'ai en stock » même à 0 u. enregistré, après confirmation, sans quantité", async () => {
    const fixture = TestBed.createComponent(PharmaDash);
    fixture.componentRef.setInput('section', 'grouped');
    await fixture.whenStable();
    http.match(r => r.url === `${api}/pharmacy/stock`).forEach(r => r.flush({ data: [] }));
    http.match(r => r.url === `${api}/pharmacy/grouped-alerts`).forEach(r => r.flush({ data: [
      { response_id: 7, search_id: 3, medicine_id: 9, medicine: 'Ventoline', form: 'spray', dosage: '100µg', created_at: null },
    ] }));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const yes = [...el.querySelectorAll('button')].find(b => b.textContent?.includes("J'ai en stock"));
    expect(yes).toBeTruthy();

    yes!.click();
    await fixture.whenStable();
    expect(http.match(r => r.url.includes('/grouped-alerts/7/respond')).length).toBe(0); // confirmation d'abord
    expect(el.textContent).toContain("vous l'avez bien en rayon ?");

    [...el.querySelectorAll('button')].find(b => b.textContent?.includes("Oui, je l'ai"))!.click();
    const req = http.expectOne(`${api}/pharmacy/grouped-alerts/7/respond`);
    expect(req.request.body).toEqual({ available: true, available_quantity: null });
  });
});
