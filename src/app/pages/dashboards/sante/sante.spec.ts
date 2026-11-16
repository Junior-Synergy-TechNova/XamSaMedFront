import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SanteDash } from './sante';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;

const FORM = { name: 'Doliprane', dci: '', brand: '', form: 'Comprimé', dosage: '500 mg', atc: 'n02be01', price: '1 500', category: 'both', rx: 'auto', controlled: false };

describe('SanteDash — catalogue national', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SanteDash],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function setup() {
    const fixture = TestBed.createComponent(SanteDash);
    fixture.componentRef.setInput('section', 'catalogue');
    await fixture.whenStable();
    http.match(`${api}/public-health/overview`).forEach(r => r.flush({ data: { ruptures: 0, low: 0, zones_tracked: 0, medicines_in_tension: 0 } }));
    // Catalogue admin (per_page=500) : une fiche sans DCI.
    http.match(r => r.url === `${api}/medicines` && r.params.get('per_page') === '500')
      .forEach(r => r.flush({ data: [{ id: 1, name: 'Amoxicilline', dci: null, brand: null, form: 'Gélule', dosage: '500 mg', is_controlled: false, requires_prescription: true }] }));
    await fixture.whenStable();
    return fixture;
  }

  it('signale les fiches sans DCI', async () => {
    const fixture = await setup();
    expect(fixture.componentInstance.noDciCount()).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 fiche sans DCI');
  });

  it('exige la DCI et le prix, puis crée la fiche avec la délivrance laissée à l\'API', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.openMedicine('new');

    c.submitMedicine(FORM);
    expect(c.medError()).toContain('DCI');
    http.expectNone(`${api}/admin/medicines`);

    c.submitMedicine({ ...FORM, dci: 'Paracétamol', price: '' });
    expect(c.medError()).toContain('prix');
    http.expectNone(`${api}/admin/medicines`);

    c.submitMedicine({ ...FORM, dci: ' Paracétamol ' });
    const req = http.expectOne(`${api}/admin/medicines`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Doliprane', dci: 'Paracétamol', brand: null, form: 'Comprimé', dosage: '500 mg',
      atc_code: 'N02BE01', price: 1500, category: 'both', is_controlled: false,
    });
    req.flush({ data: { id: 2, name: 'Doliprane' } }, { status: 201, statusText: 'Created' });
    expect(c.medModal()).toBeNull();
    // Le catalogue est relu après l'ajout.
    expect(http.match(r => r.url === `${api}/medicines` && r.params.get('per_page') === '500').length).toBe(1);
  });

  it('affiche le message de validation de l\'API', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.openMedicine('new');
    c.submitMedicine({ ...FORM, dci: 'Paracétamol' });
    http.expectOne(`${api}/admin/medicines`).flush(
      { message: 'invalid', errors: { name: ['Ce nom est déjà pris.'] } },
      { status: 422, statusText: 'Unprocessable' },
    );
    expect(c.medError()).toBe('Ce nom est déjà pris.');
    expect(c.medModal()).toBe('new');
  });
});
