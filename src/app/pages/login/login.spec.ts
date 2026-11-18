import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginScreen } from './login';
import { PlatformState } from '../../services/platform/platform';
import { environment } from '../../../environments/environment';

const api = environment.apiUrl;

describe('LoginScreen', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginScreen],
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });
  afterEach(() => localStorage.clear());

  /** Le mot de passe n'est plus pré-rempli : on le saisit comme un utilisateur. */
  const typePassword = (c: LoginScreen) => c.setPassword({ target: { value: 'secret' } } as unknown as Event);

  it("le mot de passe n'est jamais pré-rempli", () => {
    const c = TestBed.createComponent(LoginScreen).componentInstance;
    expect(c.password()).toBe('');
    c.pick('pharma');
    expect(c.password()).toBe('');
  });

  it('une tuile de rôle ne fait que pré-remplir l\'email de démonstration', () => {
    const c = TestBed.createComponent(LoginScreen).componentInstance;
    c.pick('hopital');
    expect(c.email()).toBe('hopital@xamsamed.test');
    http.expectNone(`${api}/login`);
  });

  it('le rôle vient du backend, pas de la tuile choisie, puis ouverture de /app', () => {
    const c = TestBed.createComponent(LoginScreen).componentInstance;
    c.pick('patient'); // tuile patient…
    typePassword(c);
    c.login();
    http.expectOne(`${api}/login`).flush({ user: { id: 1, name: 'A', email: 'a@x', phone: null, role: 'pharmacy_user', structure_id: 3 }, token: 't' });
    expect(TestBed.inject(PlatformState).role()).toBe('pharma'); // …mais compte pharmacien
    expect(navigate).toHaveBeenCalledWith('/app');
    expect(c.loading()).toBe(false);
  });

  it('messages d\'erreur : identifiants invalides, serveur injoignable, champs vides', () => {
    const c = TestBed.createComponent(LoginScreen).componentInstance;
    typePassword(c);
    c.login();
    http.expectOne(`${api}/login`).flush({ message: 'bad' }, { status: 401, statusText: 'Unauthorized' });
    expect(c.error()).toBe('Identifiants invalides.');

    c.login();
    http.expectOne(`${api}/login`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    expect(c.error()).toContain('Serveur injoignable');
    expect(navigate).not.toHaveBeenCalled();

    c.setPassword({ target: { value: '' } } as unknown as Event);
    c.login();
    http.expectNone(`${api}/login`);
    expect(c.error()).toContain('Renseignez');
  });
});
