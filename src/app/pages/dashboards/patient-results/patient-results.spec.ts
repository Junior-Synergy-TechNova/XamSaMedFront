import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PatientResults } from './patient-results';
import { environment } from '../../../../environments/environment';

const api = environment.apiUrl;

describe('PatientResults — équivalents', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PatientResults],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('en rupture partout : montre la mise en garde, les équivalents avec leurs avertissements et les alternatives à part', async () => {
    const fixture = TestBed.createComponent(PatientResults);
    fixture.componentRef.setInput('med', { id: '7', nom: 'Doliprane 500 mg', dci: 'Paracétamol', forme: 'comprimé', crit: false, cat: '' });
    await fixture.whenStable();

    http.expectOne(r => r.url === `${api}/medicines/7/availability`).flush({ data: [] });
    await fixture.whenStable();
    http.expectOne(r => r.url === `${api}/medicines/7/equivalents`).flush({
      disclaimer: "La substitution d'un médicament doit se faire uniquement avec l'avis de votre pharmacien.",
      fallback: false,
      data: [{
        id: 8, name: 'Efferalgan', dosage: '1 g', form: 'comprimé', dci: 'Paracétamol', note: null,
        match_level: 'dosage_differs', same_dci: true, score: 70, available_pharmacies: 2, nearest_km: 1.2,
        warnings: [{ code: 'dosage_differs', message: 'Dosage différent (1 g au lieu de 500 mg) : la posologie change.' }],
      }],
      alternatives: {
        requires_validation: true,
        notice: 'Molécule différente : à valider obligatoirement par un médecin ou un pharmacien.',
        data: [{ id: 9, name: 'Ibuprofène', dosage: '400 mg', form: 'comprimé', dci: 'Ibuprofène', note: null, same_dci: false, score: null, available_pharmacies: 1, reasons: ['Autre molécule (DCI : Ibuprofène)'] }],
      },
    });
    await fixture.whenStable();

    const c = fixture.componentInstance;
    expect(c.equivalents().map(e => e.id)).toEqual([8]);
    expect(c.alternatives().map(e => e.id)).toEqual([9]);

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain("avec l'avis de votre pharmacien");
    expect(text).toContain('Dosage différent (1 g au lieu de 500 mg)');
    expect(text).not.toContain('null');
    expect(text).not.toContain('/100');
    // L'alternative vit dans son propre bloc, sans bouton « Voir ».
    const alt = el.querySelector('.pf-eq-alt');
    expect(alt?.textContent).toContain('Ibuprofène');
    expect(alt?.textContent).toContain('À valider');
    expect(alt?.querySelector('button')).toBeNull();
    http.verify();
  });

  it('disponibilités illisibles : « Réessayer », jamais « aucune disponibilité » ni recherche groupée', async () => {
    const fixture = TestBed.createComponent(PatientResults);
    fixture.componentRef.setInput('med', { id: '7', nom: 'Doliprane 500 mg', dci: 'Paracétamol', forme: 'comprimé', crit: false, cat: '' });
    await fixture.whenStable();
    http.expectOne(r => r.url === `${api}/medicines/7/availability`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();

    const c = fixture.componentInstance;
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(c.loadError()).toBe(true);
    expect(text).toContain("n'ont pas pu être chargées");
    expect(text).not.toContain('Aucune disponibilité publique');
    http.expectNone(r => r.url === `${api}/medicines/7/equivalents`);

    c.retry();
    await fixture.whenStable();
    http.expectOne(r => r.url === `${api}/medicines/7/availability`).flush({ data: [{ structure_id: 3, pharmacy_name: 'Pharmacie Centrale', available: 4, status: 'available' }] });
    await fixture.whenStable();
    expect(c.loadError()).toBe(false);
    expect(c.availableCount()).toBe(1);
  });

  it('distances depuis le domicile : le dit et propose « Utiliser ma position actuelle »', async () => {
    const fixture = TestBed.createComponent(PatientResults);
    fixture.componentRef.setInput('med', { id: '7', nom: 'Doliprane 500 mg', dci: 'Paracétamol', forme: 'comprimé', crit: false, cat: '' });
    await fixture.whenStable();
    http.expectOne(r => r.url === `${api}/medicines/7/availability`).flush({
      position_source: 'home',
      data: [{ structure_id: 3, pharmacy_name: 'Pharmacie du Port', available: 4, status: 'available', distance_metres: 1500, distance_label: '1.5 km' }],
    });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('depuis votre domicile enregistré');
    expect(text).toContain('Utiliser ma position actuelle');
    expect(text).toContain('1.5 km');
  });

  it('sans aucune position : pas de distance inventée', async () => {
    const fixture = TestBed.createComponent(PatientResults);
    fixture.componentRef.setInput('med', { id: '7', nom: 'Doliprane 500 mg', dci: 'Paracétamol', forme: 'comprimé', crit: false, cat: '' });
    await fixture.whenStable();
    http.expectOne(r => r.url === `${api}/medicines/7/availability`).flush({
      position_source: null,
      data: [{ structure_id: 3, pharmacy_name: 'Pharmacie Centrale', available: 4, status: 'available', latitude: 14.6928, longitude: -17.4467, distance_metres: null }],
    });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('Utiliser ma position');
    expect(el.querySelector('.pf-libody .pf-tx')).toBeNull(); // aucune distance affichée sur la ligne
    expect(text).toContain('Pharmacie disponible');
  });
});
