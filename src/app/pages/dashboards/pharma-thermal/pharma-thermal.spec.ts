import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PharmaThermal } from './pharma-thermal';
import { ApiPharmacyThermalItem } from '../../../interfaces/api';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const url = `${environment.apiUrl}/pharmacy/thermal-status`;

function row(over: Partial<ApiPharmacyThermalItem>): ApiPharmacyThermalItem {
  return {
    stock_id: 1, medicine_id: 1, medicine: 'Amoxicilline', dosage: '500 mg', form: 'gélule', quantity: 40,
    storage: 'room', max_temp_c: 25, min_temp_c: null, at_risk: false, source: 'notice', validated: false, ...over,
  };
}

describe('PharmaThermal', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PharmaThermal],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('explique que le service n\'existe pas encore (404) au lieu d\'afficher une liste vide', async () => {
    const fixture = TestBed.createComponent(PharmaThermal);
    http.expectOne(url).flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Surveillance pas encore disponible');
  });

  it('classe le stock : trop chaud, proche du seuil, chaîne du froid', async () => {
    const fixture = TestBed.createComponent(PharmaThermal);
    http.expectOne(url).flush({
      current_temp_c: 29, checked_at: '2026-11-15T14:00:00Z', location: { lat: 14.69, lng: -17.44 }, items_at_risk: 1,
      data: [
        row({ stock_id: 1, at_risk: true }),
        row({ stock_id: 2, medicine: 'Paracétamol', max_temp_c: 30 }),
        row({ stock_id: 3, medicine: 'Insuline Glargine', storage: 'fridge', max_temp_c: 8, min_temp_c: 2, validated: true }),
      ],
    });
    await fixture.whenStable();
    const c = fixture.componentInstance;
    expect(c.counts()).toEqual({ watched: 3, atRisk: 1, near: 1, fridge: 1, unvalidated: 2 });
    expect(c.roomRows()[0].item.medicine).toBe('Amoxicilline');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Trop chaud');
    expect(text).toContain('+4 °C');
    expect(text).toContain('Insuline Glargine');
  });

  it("« à valider » n'est pas une source ; l'« Actualiser » du tableau de bord relit la météo", async () => {
    const fixture = TestBed.createComponent(PharmaThermal);
    const body = (temp: number) => ({
      current_temp_c: temp, checked_at: '2026-11-15T14:00:00Z', location: { lat: 14.69, lng: -17.44 }, items_at_risk: 0,
      data: [row({ stock_id: 1, source: 'à valider' }), row({ stock_id: 2, medicine: 'Quinine', source: 'OMS', validated: true })],
    });
    http.expectOne(url).flush(body(20));
    await fixture.whenStable();
    const c = fixture.componentInstance;
    expect(c.roomRows().map(r => r.source)).toEqual([null, 'OMS']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Météo de');

    fixture.componentRef.setInput('refreshKey', 1);
    await fixture.whenStable();
    http.expectOne(url).flush(body(31));
    await fixture.whenStable();
    expect(c.status()?.current_temp_c).toBe(31);
  });
});
