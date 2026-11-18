import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AppShell } from './shell';
import { PlatformState } from '../../services/platform/platform';
import { environment } from '../../../environments/environment';

registerLocaleData(localeFr);
const api = environment.apiUrl;

// Premier rendu du shell lent quand toute la suite tourne en parallèle (compilation JIT des composants).
describe('AppShell — navigation', { timeout: 20_000 }, () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    // jsdom n'implémente pas matchMedia (le shell suit la largeur d'écran).
    window.matchMedia ??= ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    TestBed.configureTestingModule({
      // Les tableaux de bord (@defer) restent hors du test : on vérifie le shell seul.
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
        provideRouter([{ path: 'app', component: AppShell }, { path: 'login', children: [] }]),
        { provide: LOCALE_ID, useValue: 'fr' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  async function open(url: string) {
    TestBed.inject(PlatformState).setRole('hopital');
    const harness = await RouterTestingHarness.create();
    const shell = await harness.navigateByUrl(url, AppShell);
    return { harness, shell };
  }

  it('menu du compte : mot de passe, notifications et déconnexion ; « Se déconnecter » aussi dans la sidebar', async () => {
    const { shell, harness } = await open('/app');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('.pf-sidefoot .pf-navexit')?.textContent).toContain('Se déconnecter');

    shell.toggleProfile(new Event('click'));
    await harness.fixture.whenStable();
    const items = [...el.querySelectorAll('.pf-rolemenu .pf-rolemenuit')].map(b => b.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(['Changer le mot de passe', 'Se déconnecter']));
    expect(items.some(t => t?.startsWith('Notifications'))).toBe(true);
    // La langue des alertes vocales ne concerne que le patient.
    expect(el.querySelector('.pf-rolemenu pf-voice-lang')).toBeNull();

    shell.openPassword();
    await harness.fixture.whenStable();
    expect(shell.profileOpen()).toBe(false);
    expect(el.querySelector('pf-password-modal h2')?.textContent).toContain('Changer le mot de passe');
  });

  it('la section de l\'URL l\'emporte sur la section mémorisée', async () => {
    TestBed.inject(PlatformState).saveSection('hopital', 'history');
    const { shell } = await open('/app?s=stock');
    expect(shell.sec()).toBe('stock');
  });

  it('une section inconnue dans l\'URL retombe sur la section mémorisée', async () => {
    TestBed.inject(PlatformState).saveSection('hopital', 'history');
    const { shell } = await open('/app?s=nimporte');
    expect(shell.sec()).toBe('history');
  });

  it('pastilles : le travail publié par l\'espace remplace le compte des notifications', async () => {
    const { shell, harness } = await open('/app');
    http.expectOne(`${api}/notifications`).flush({ data: [] });
    http.expectOne(`${api}/hospital/alerts`).flush({ data: [
      { id: 1, medicine: 'Insuline', service: 'Urgences', severity: 'rupture', remaining_quantity: 0 },
      { id: 2, medicine: 'Morphine', service: 'Bloc', severity: 'tension', remaining_quantity: 3 },
    ] });
    await harness.fixture.whenStable();
    const badge = (id: string) => shell.nav().find(n => n.id === id)?.badge;

    // Pas d'espace actif (navCounts null) : repli sur les notifications non lues.
    expect(badge('alert')).toBe(2);

    TestBed.inject(PlatformState).navCounts.set({ alert: 5, stock: 1 });
    expect(badge('alert')).toBe(5);
    expect(badge('stock')).toBe(1);
    expect(badge('crit')).toBe(0);
  });

  it('recherche du haut en échec : message dédié, pas « aucun résultat »', async () => {
    const { shell } = await open('/app');
    vi.useFakeTimers();
    shell.searchGlobal({ target: { value: 'amox' } } as unknown as Event);
    vi.advanceTimersByTime(300);
    http.expectOne(r => r.url === `${api}/search`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(shell.searchError()).toBe(true);
    expect(shell.searchLoading()).toBe(false);

    shell.searchGlobal({ target: { value: 'para' } } as unknown as Event);
    vi.advanceTimersByTime(300);
    http.expectOne(r => r.url === `${api}/search`).flush({ data: [] });
    expect(shell.searchError()).toBe(false);
  });

  it('Échap ferme le panneau ouvert et rend le focus à son bouton, avant le tiroir', async () => {
    const { shell, harness } = await open('/app');
    const el = harness.fixture.nativeElement as HTMLElement;
    const escape = () => el.querySelector('.pf-app')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const bell = el.querySelector<HTMLElement>('.pf-notifwrap .pf-iconbtn')!;

    bell.click();
    await harness.fixture.whenStable();
    expect(shell.notifOpen()).toBe(true);
    escape();
    expect(shell.notifOpen()).toBe(false);
    expect(document.activeElement).toBe(bell);

    el.querySelector<HTMLElement>('.pf-roleswbtn')!.click();
    await harness.fixture.whenStable();
    expect(shell.profileOpen()).toBe(true);
    escape();
    expect(shell.profileOpen()).toBe(false);

    // Panneau et tiroir ouverts : un appui ferme le panneau, le suivant le tiroir.
    shell.drawerOpen.set(true);
    shell.notifOpen.set(true);
    escape();
    expect(shell.notifOpen()).toBe(false);
    expect(shell.drawerOpen()).toBe(true);
    escape();
    expect(shell.drawerOpen()).toBe(false);
  });

  it('tiroir (téléphone) : le bouton « Fermer le menu » le referme', async () => {
    const { shell, harness } = await open('/app');
    shell.openDrawer();
    await harness.fixture.whenStable();
    const close = harness.routeNativeElement?.querySelector<HTMLButtonElement>('.pf-drawerclose');
    expect(close?.getAttribute('aria-label')).toBe('Fermer le menu');
    close?.click();
    expect(shell.drawerOpen()).toBe(false);
  });
});
