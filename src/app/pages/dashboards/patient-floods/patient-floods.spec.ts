import { TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PatientFloods } from './patient-floods';
import { ApiFloodReport } from '../../../interfaces/api';
import { environment } from '../../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;

function flood(over: Partial<ApiFloodReport>): ApiFloodReport {
  return {
    id: 1, latitude: 14.6937, longitude: -17.4441, severity: 'impassable', severity_label: 'Impraticable',
    status: 'confirmed', status_label: 'Confirmé', confirmations: 3, confirmations_required: 3,
    reported_at: '2026-11-15T08:00:00Z', last_confirmed_at: '2026-11-15T09:00:00Z', expires_at: '2026-11-15T15:00:00Z',
    distance_metres: 350, confirmed_by_me: false, ...over,
  };
}

describe('PatientFloods', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientFloods],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(), { provide: LOCALE_ID, useValue: 'fr' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('lit les signalements autour de Dakar et repère les pharmacies proches d\'une inondation confirmée', async () => {
    const fixture = TestBed.createComponent(PatientFloods);
    await fixture.whenStable();
    const req = http.expectOne(r => r.url === `${api}/flood-reports`);
    expect(req.request.params.get('radius')).toBe('5000');
    req.flush({ data: [flood({}), flood({ id: 2, status: 'active', status_label: 'Signalé', latitude: 14.70, longitude: -17.43, severity: 'difficult', severity_label: 'Praticable avec difficulté' })] });
    http.expectOne(`${api}/pharmacies`).flush({ data: [
      { id: 10, name: 'Pharmacie du Port', city: 'Dakar', latitude: 14.6950, longitude: -17.4441 }, // ~150 m de l'inondation confirmée
      { id: 11, name: 'Pharmacie Liberté', city: 'Dakar', latitude: 14.7200, longitude: -17.4600 },
      { id: 12, name: 'Sans position', city: 'Dakar', latitude: null, longitude: null },
    ] });
    await fixture.whenStable();

    const c = fixture.componentInstance;
    expect(c.counts()).toEqual({ total: 2, confirmed: 1, impassable: 1, pharmacies: 1 });
    expect(c.affected()[0].pharmacy.name).toBe('Pharmacie du Port');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Impraticable');
    expect(text).toContain('3 / 3 personnes');
  });

  it('affiche une erreur au lieu de « aucune route inondée » si la lecture échoue', async () => {
    const fixture = TestBed.createComponent(PatientFloods);
    await fixture.whenStable();
    http.expectOne(r => r.url === `${api}/flood-reports`).flush({}, { status: 500, statusText: 'Error' });
    http.expectOne(`${api}/pharmacies`).flush({ data: [] });
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Signalements non chargés');
    expect(text).not.toContain('Aucune route inondée signalée');
  });
});
