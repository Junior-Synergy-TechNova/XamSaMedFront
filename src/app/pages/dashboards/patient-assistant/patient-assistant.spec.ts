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

  it('dictée : le texte compris arrive dans la saisie, puis part avec source « voice »', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    (c as unknown as { transcribe(b: Blob, e: string): void }).transcribe(new Blob(['x'], { type: 'audio/webm' }), 'webm');
    expect(c.transcribing()).toBe(true);
    const t = http.expectOne(`${api}/ai/transcribe`);
    expect(t.request.body instanceof FormData).toBe(true);
    t.flush({ transcription: 'Où trouver du parasitamol ?' });
    await fixture.whenStable();

    expect(c.draft()).toBe('Où trouver du parasitamol ?');
    expect(c.dictated()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Voici ce que j\'ai compris');

    c.onInput({ target: { value: 'Où trouver du paracétamol ?' } } as unknown as Event); // le patient corrige
    c.send();
    expect(http.expectOne(`${api}/ai/chat`).request.body).toEqual({ message: 'Où trouver du paracétamol ?', client: 'web', source: 'voice' });
    expect(c.messages()[0].voice).toBe(true);
  });

  it('dictée sur un serveur sans /ai/transcribe : repli sur /ai/voice', async () => {
    const fixture = TestBed.createComponent(PatientAssistant);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    (c as unknown as { transcribe(b: Blob, e: string): void }).transcribe(new Blob(['x']), 'webm');
    http.expectOne(`${api}/ai/transcribe`).flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    http.expectOne(`${api}/ai/voice`).flush({ transcription: 'Ventoline ?', reply: 'Disponible.', session_id: 's' });
    await fixture.whenStable();
    expect(c.messages().map(m => m.text)).toEqual(['Ventoline ?', 'Disponible.']);
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
