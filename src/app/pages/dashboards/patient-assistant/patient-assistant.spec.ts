import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PatientAssistant } from './patient-assistant';
import { AssistantService } from '../../../services/assistant/assistant';
import { environment } from '../../../../environments/environment';

const api = environment.apiUrl;

describe('PatientAssistant', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem('nova-token', 'tok-patient');
    TestBed.configureTestingModule({
      imports: [PatientAssistant],
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.removeItem('nova-token'));

  it('envoie la question avec client « web » puis réutilise la session', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    const c = fixture.componentInstance;

    c.send('Où trouver du **paracétamol** ?');
    const first = http.expectOne(`${api}/ai/chat`);
    expect(first.request.body).toEqual({ message: 'Où trouver du **paracétamol** ?', client: 'web' });
    first.flush({ reply: 'Disponible à la **Pharmacie Centrale**.', session_id: 'session_1' });
    await fixture.whenStable();

    const bot = (fixture.nativeElement as HTMLElement).querySelector('.pf-as-msg.bot')?.textContent ?? '';
    expect(bot.trim()).toBe('Disponible à la Pharmacie Centrale.');

    c.send('Et en sirop ?');
    expect(http.expectOne(`${api}/ai/chat`).request.body).toMatchObject({ session_id: 'session_1' });
  });

  it('affiche une urgence en rouge avec les numéros à appeler', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    fixture.componentInstance.send('Mon fils ne respire plus');
    http.expectOne(`${api}/ai/chat`).flush({ reply: 'Appelez le SAMU au 1515.', session_id: 's', urgence: true });
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pf-as-msg.urgent')).not.toBeNull();
    expect([...el.querySelectorAll('a[href^="tel:"]')].map(a => a.getAttribute('href'))).toEqual(['tel:1515', 'tel:18']);
  });

  it('IA indisponible : message d\'erreur et « Réessayer » renvoie la même question', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.send('Ventoline ?');
    http.expectOne(`${api}/ai/chat`).flush(
      { message: "L'assistant IA est momentanément indisponible.", code: 'ai_unavailable', session_id: 's2' },
      { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();

    const err = c.messages().find(m => m.kind === 'error');
    expect(err?.retry).toBe('Ventoline ?');
    c.retry(err!.id, err!.retry!);
    const again = http.expectOne(`${api}/ai/chat`);
    expect(again.request.body).toMatchObject({ message: 'Ventoline ?', session_id: 's2' });
    expect(c.messages().some(m => m.kind === 'error')).toBe(false);
  });

  type Voice = { sendVoice(b: Blob, e: string, s: number): void };

  it('mode vocal : la question part directement à /ai/voice, le fil montre un message vocal sans le texte transcrit', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    (c as unknown as Voice).sendVoice(new Blob(['x'], { type: 'audio/webm' }), 'webm', 6);
    expect(http.match(`${api}/ai/transcribe`).length).toBe(0);
    const v = http.expectOne(`${api}/ai/voice`);
    const body = v.request.body as FormData;
    expect(body.get('client')).toBe('web');
    expect(body.get('audio')).toBeInstanceOf(Blob);
    v.flush({ transcription: 'Où trouver du parasitamol ?', reply: 'Disponible à la Pharmacie Centrale.', session_id: 's' });
    await fixture.whenStable();

    expect(c.messages()[0]).toMatchObject({ from: 'me', voice: true, seconds: 6, text: '' });
    expect(c.messages()[1].text).toBe('Disponible à la Pharmacie Centrale.');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pf-as-voicenote')?.textContent).toContain('Message vocal · 6 s');
    expect(el.textContent).not.toContain('parasitamol');
    expect(c.draft()).toBe('');
  });

  it('mode vocal en échec : message d\'erreur sans « Réessayer » (il faut réenregistrer)', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    (c as unknown as Voice).sendVoice(new Blob(['x']), 'webm', 3);
    http.expectOne(`${api}/ai/voice`).flush({ message: 'Erreur' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    const err = c.messages().find(m => m.kind === 'error');
    expect(err).toBeDefined();
    expect(err?.retry).toBeUndefined();
  });

  it('un autre compte connecté repart d\'une conversation vide', () => {
    const svc = TestBed.inject(AssistantService);
    svc.claim();
    svc.push({ from: 'me', text: 'question du premier compte' });
    svc.sessionId.set('s-old');
    localStorage.setItem('nova-token', 'tok-autre');
    svc.claim();
    expect(svc.messages()).toEqual([]);
    expect(svc.sessionId()).toBeNull();
  });
});
