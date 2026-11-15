import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PatientCabinet } from './patient-cabinet';
import { ApiCabinetItem } from '../../../interfaces/api';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;

function item(over: Partial<ApiCabinetItem> = {}): ApiCabinetItem {
  return {
    id: 1, member: null,
    medicine: { id: 7, name: 'Insuline Glargine', brand: null, form: 'stylo', dosage: '100 UI/ml', is_controlled: false },
    expiry_date: '2026-11-20', expiry_level: 'crit', expiry_color: 'red', days_to_expiry: 5, expiring_soon: true, expires_today: false,
    storage_location: 'room', storage_label: 'Pièce', fridge_power_cuts: null, opened: false, opened_at: null,
    ...over,
  };
}

describe('PatientCabinet', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientCabinet],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(items: ApiCabinetItem[], thermal: { status: number; body: object }) {
    const fixture = TestBed.createComponent(PatientCabinet);
    http.expectOne(r => r.url === `${api}/cabinet`).flush({ data: items, pagination: {} });
    const t = http.expectOne(`${api}/cabinet/thermal-status`);
    if (thermal.status === 200) t.flush(thermal.body); else t.flush(thermal.body, { status: thermal.status, statusText: 'Error' });
    http.expectOne(`${api}/cabinet/members`).flush({ data: [{ id: 3, name: 'Awa', relationship: 'child' }] });
    await fixture.whenStable();
    return fixture;
  }

  it('propose de localiser le domicile tant que la météo ne peut pas être comparée (422)', async () => {
    const fixture = await render([item()], { status: 422, body: { message: 'Localisez votre domicile pour activer la surveillance thermique.' } });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Activez la surveillance de la chaleur');
    expect(text).toContain('Insuline Glargine');
    expect(fixture.componentInstance.counts().soon).toBe(1);
  });

  it('signale les médicaments exposés à la chaleur', async () => {
    const fixture = await render([item(), item({ id: 2, expiry_level: 'ok', expiry_color: 'green', days_to_expiry: 200, expiring_soon: false })], {
      status: 200,
      body: {
        current_temp_c: 36.4, location: { lat: 14.69, lng: -17.44 }, items_at_risk: 1,
        data: [
          { id: 1, medicine: 'Insuline Glargine', max_temp_c: 25, requires_fridge: true, current_temp: 36.4, at_risk: true, hours_above_threshold: 5, last_alerted_at: null, risk_note: '' },
          { id: 2, medicine: 'Insuline Glargine', max_temp_c: 30, requires_fridge: false, current_temp: 36.4, at_risk: false, hours_above_threshold: 0, last_alerted_at: null, risk_note: '' },
        ],
      },
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1 médicament exposé');
    expect(text).toContain('Trop chaud');
    expect(fixture.componentInstance.counts().heat).toBe(1);
  });

  it('envoie le médicament choisi, le proche et le lieu de rangement', async () => {
    const fixture = await render([], { status: 422, body: {} });
    const c = fixture.componentInstance;
    c.openAdd();
    http.expectOne(r => r.url === `${api}/medicines`).flush({ data: [{ id: 7, name: 'Insuline Glargine', dosage: '100 UI/ml', form: 'stylo' }] });
    c.patchForm({ medicine: 'Insuline Glargine', member: '3', expiry: '2027-03-01', storage: 'fridge', powerCuts: true });
    c.saveItem();
    const req = http.expectOne(r => r.method === 'POST' && r.url === `${api}/cabinet`);
    expect(req.request.body).toEqual({
      medicine_id: 7, family_member_id: 3, expiry_date: '2027-03-01', storage_location: 'fridge', fridge_power_cuts: true, opened_at: null,
    });
    req.flush(item({ id: 9 }));
    http.expectOne(r => r.url === `${api}/cabinet`).flush({ data: [item({ id: 9 })], pagination: {} });
    http.expectOne(`${api}/cabinet/thermal-status`).flush({}, { status: 422, statusText: 'Error' });
    expect(c.form()).toBeNull();
  });
});
