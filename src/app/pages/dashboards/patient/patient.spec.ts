import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PatientDash } from './patient';
import { Med } from '../../../interfaces/models';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;
const amox: Med = { id: '5', nom: 'Amoxicilline 500 mg', dci: 'Amoxicilline', forme: 'gélule', crit: false, cat: 'Médicament' };

describe('PatientDash — médicament sur ordonnance', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function create() {
    const fixture = TestBed.createComponent(PatientDash);
    fixture.componentRef.setInput('section', 'search');
    http.expectOne(`${api}/orders`).flush({ data: [] });
    http.expectOne(`${api}/pharmacies`).flush({ data: [{ id: 3, name: 'Pharmacie du Port', type: 'pharmacy', city: 'Dakar', latitude: 14.69, longitude: -17.44 }] });
    return fixture;
  }

  it('propose d\'envoyer l\'ordonnance à la pharmacie choisie au lieu d\'un échec', async () => {
    const fixture = create();
    const c = fixture.componentInstance;
    c.reserve(amox, 3);
    http.expectOne(`${api}/orders`).flush(
      { message: 'Ce médicament nécessite une ordonnance.', requires_prescription: true, medicine: 'Amoxicilline' },
      { status: 422, statusText: 'Unprocessable' },
    );
    expect(c.prescriptionModal()).toBe(true);
    expect(c.prescriptionPharmacy()).toBe(3);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Amoxicilline est délivré sur ordonnance');
  });

  it('affiche le message de l\'API pour un autre refus', () => {
    const fixture = create();
    const c = fixture.componentInstance;
    c.reserve(amox, 3);
    http.expectOne(`${api}/orders`).flush({ message: 'Stock insuffisant. Disponible : 0 unité(s).' }, { status: 422, statusText: 'Unprocessable' });
    expect(c.prescriptionModal()).toBe(false);
  });
});

describe('PatientDash — lectures en échec', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });
  const DOWN = { status: 0, statusText: 'Unknown Error' };

  it('recherche en échec : « Réessayer », jamais « aucun médicament trouvé »', async () => {
    const fixture = TestBed.createComponent(PatientDash);
    fixture.componentRef.setInput('section', 'search');
    const c = fixture.componentInstance;
    c.setQuery('amox');
    http.expectOne(r => r.url === `${api}/medicines`).error(new ProgressEvent('error'), DOWN);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(c.searchError()).toBe(true);
    expect(text).toContain("La recherche n'a pas pu aboutir");
    expect(text).not.toContain('Aucun médicament trouvé');

    c.retrySearch();
    http.expectOne(r => r.url === `${api}/medicines`).flush({ data: [{ id: 5, name: 'Amoxicilline', dosage: '500 mg', form: 'gélule', brand: null, is_controlled: false }] });
    expect(c.searchError()).toBe(false);
    expect(c.results().length).toBe(1);
  });

  it('une réponse arrivée après une nouvelle saisie n\'écrase pas les résultats', () => {
    const fixture = TestBed.createComponent(PatientDash);
    fixture.componentRef.setInput('section', 'search');
    const c = fixture.componentInstance;
    c.setQuery('amo');
    const slow = http.expectOne(r => r.url === `${api}/medicines` && r.params.get('search') === 'amo');
    c.setQuery('para');
    http.expectOne(r => r.url === `${api}/medicines` && r.params.get('search') === 'para')
      .flush({ data: [{ id: 7, name: 'Paracétamol', dosage: '500 mg', form: 'comprimé', brand: null, is_controlled: false }] });
    slow.flush({ data: [] });
    expect(c.results().map(m => m.id)).toEqual(['7']);
  });

  it('réservations illisibles : écran « Réessayer » au lieu de « aucune réservation », pastilles publiées', async () => {
    const fixture = TestBed.createComponent(PatientDash);
    fixture.componentRef.setInput('section', 'resa');
    http.expectOne(`${api}/orders`).error(new ProgressEvent('error'), DOWN);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Impossible de charger vos réservations');

    c.loadResas();
    http.expectOne(`${api}/orders`).flush({ data: [
      { id: 1, status: 'confirmed', medicine: 'Amoxicilline', pharmacy: 'Pharmacie du Port', created_at: '2026-11-15T09:00:00Z' },
      { id: 2, status: 'pending', medicine: 'Ventoline', pharmacy: 'Pharmacie du Port', created_at: '2026-11-15T09:00:00Z' },
    ] });
    http.expectOne(r => r.url === `${api}/cabinet`).flush({ data: [{ id: 9, expiry_level: 'expired' }, { id: 10, expiry_level: 'ok' }] });
    await fixture.whenStable();
    expect(c.resasError()).toBe(false);
    expect(c.resasToHandle()).toBe(1);
    expect(c.cabinetToHandle()).toBe(1);
  });
});
