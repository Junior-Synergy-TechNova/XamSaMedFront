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
