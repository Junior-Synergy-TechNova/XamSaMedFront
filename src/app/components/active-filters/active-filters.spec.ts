import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveFilter, ActiveFilters } from './active-filters';

describe('ActiveFilters — ligne « Filtres cumulés »', () => {
  let fixture: ComponentFixture<ActiveFilters>;
  let el: HTMLElement;

  const render = async (filters: ActiveFilter[]) => {
    fixture.componentRef.setInput('filters', filters);
    await fixture.whenStable();
  };
  const text = () => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const chips = () => [...el.querySelectorAll<HTMLButtonElement>('.pf-af-chip')];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ActiveFilters], providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(ActiveFilters);
    el = fixture.nativeElement;
  });

  it("n'affiche rien sans filtre", async () => {
    await render([]);
    expect(el.querySelector('.pf-af')).toBeNull();
  });

  it('un filtre : « Filtre appliqué », pas de « et » ni de « Tout effacer »', async () => {
    await render([{ key: 'controlled', label: 'Contrôlés' }]);
    expect(text()).toContain('Filtre appliqué :');
    expect(el.querySelectorAll('.pf-af-and').length).toBe(0);
    expect(el.querySelector('.pf-af-clear')).toBeNull();
    expect(el.querySelector('.pf-af')!.getAttribute('aria-label')).toBe('Filtres appliqués');
  });

  it('plusieurs filtres : « Filtres cumulés », reliés par « et », avec « Tout effacer »', async () => {
    await render([
      { key: 'status', label: 'Rupture' },
      { key: 'expiry', label: 'Périmés' },
      { key: 'controlled', label: 'Contrôlés' },
    ]);
    // Angular retire les espaces entre éléments : l'espacement visuel vient du gap CSS.
    const parts = [...el.querySelectorAll('.pf-af-lbl, .pf-af-and, .pf-af-chip')].map(n => n.textContent?.trim());
    expect(parts).toEqual(['Filtres cumulés :', 'Rupture', 'et', 'Périmés', 'et', 'Contrôlés']);
    expect(el.querySelector('.pf-af-clear')?.textContent?.trim()).toBe('Tout effacer');
  });

  it('chaque puce retire son filtre (nom accessible explicite)', async () => {
    await render([{ key: 'query', label: '« amox »' }, { key: 'status', label: 'Rupture' }]);
    const removed: string[] = [];
    fixture.componentInstance.remove.subscribe(k => removed.push(k));
    expect(chips()[1].getAttribute('aria-label')).toBe('Retirer le filtre Rupture');
    chips()[1].click();
    chips()[0].click();
    expect(removed).toEqual(['status', 'query']);
  });

  it('« Tout effacer » émet clear', async () => {
    await render([{ key: 'status', label: 'Rupture' }, { key: 'controlled', label: 'Contrôlés' }]);
    let cleared = 0;
    fixture.componentInstance.clear.subscribe(() => cleared++);
    el.querySelector<HTMLButtonElement>('.pf-af-clear')!.click();
    expect(cleared).toBe(1);
  });
});
