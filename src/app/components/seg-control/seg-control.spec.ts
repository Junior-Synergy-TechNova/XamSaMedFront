import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SegControl, SegOption } from './seg-control';

type Level = 'all' | 'rupture' | 'tension';

@Component({
  imports: [SegControl],
  template: `<span id="lbl">Niveau</span><pf-seg [options]="options" [(value)]="value" labelledBy="lbl"/>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly options: readonly SegOption<Level>[] = [
    { id: 'all', label: 'Tous' }, { id: 'rupture', label: 'Ruptures' }, { id: 'tension', label: 'Tensions' },
  ];
  readonly value = signal<Level>('all');
}

describe('SegControl — sélecteur segmenté (un seul choix)', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.pf-seg-btn')];
  const checked = () => buttons().filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.textContent?.trim());
  const key = async (target: HTMLElement, k: string) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };

  // jsdom ne fait pas de mise en page : chaque bouton mesure 80 px, espacés de 82 px.
  const proto = HTMLElement.prototype;
  const saved = {
    w: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
    l: Object.getOwnPropertyDescriptor(proto, 'offsetLeft'),
    s: proto.scrollIntoView,
  };
  beforeAll(() => {
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('pf-seg-btn') ? 80 : 0; } });
    Object.defineProperty(proto, 'offsetLeft', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('pf-seg-btn') ? 3 + [...this.parentElement!.querySelectorAll('.pf-seg-btn')].indexOf(this) * 82 : 0; },
    });
    proto.scrollIntoView = () => undefined; // absent de jsdom
  });
  afterAll(() => {
    if (saved.w) Object.defineProperty(proto, 'offsetWidth', saved.w);
    if (saved.l) Object.defineProperty(proto, 'offsetLeft', saved.l);
    proto.scrollIntoView = saved.s;
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('expose un groupe radio relié à son libellé, un seul choix coché et seul focusable', () => {
    const group = el.querySelector('.pf-seg')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-labelledby')).toBe('lbl');
    expect(buttons().map(b => b.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(checked()).toEqual(['Tous']);
    expect(buttons().map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('un clic change la valeur du parent (liaison [(value)])', async () => {
    buttons()[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('rupture');
    expect(checked()).toEqual(['Ruptures']);
    expect(buttons()[1].classList).toContain('on');
  });

  it('suit une valeur changée par le parent (ex. « Réinitialiser les filtres »)', async () => {
    fixture.componentInstance.value.set('tension');
    await fixture.whenStable();
    expect(checked()).toEqual(['Tensions']);
  });

  it('clavier : flèches avec retour au début, Début / Fin, focus sur le nouveau choix', async () => {
    const host = fixture.componentInstance;
    await key(buttons()[0], 'ArrowRight');
    expect(host.value()).toBe('rupture');
    expect(document.activeElement).toBe(buttons()[1]);
    await key(buttons()[1], 'End');
    expect(host.value()).toBe('tension');
    await key(buttons()[2], 'ArrowRight');
    expect(host.value()).toBe('all'); // boucle
    await key(buttons()[0], 'ArrowLeft');
    expect(host.value()).toBe('tension');
    await key(buttons()[2], 'Home');
    expect(host.value()).toBe('all');
    await key(buttons()[0], 'a'); // autre touche : rien ne change
    expect(host.value()).toBe('all');
  });

  it("l'indicateur se place sous l'option choisie, sans glisser au premier affichage puis en glissant", async () => {
    const seg = el.querySelector('.pf-seg')!;
    const ind = el.querySelector<HTMLElement>('.pf-seg-ind')!;
    expect(seg.classList).toContain('has-ind');
    expect(ind.style.transform).toBe('translateX(3px)');
    expect(ind.style.width).toBe('80px');
    expect(ind.classList).not.toContain('slide');

    buttons()[2].click();
    await fixture.whenStable();
    expect(ind.style.transform).toBe('translateX(167px)');
    expect(ind.classList).toContain('slide');
  });
});
