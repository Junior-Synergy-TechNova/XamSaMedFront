import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Apparition au défilement : ajoute la classe `in` quand l'élément entre dans la fenêtre
 * (une seule fois). Le style (`.fade-up`, `.fade-left`, `.fade-right`, `.zoom-in` et leur état
 * `.in`) est défini par la page hôte. Les éléments créés plus tard (changement d'onglet…)
 * sont observés eux aussi. Sans IntersectionObserver ou avec « réduire les animations »,
 * l'élément est affiché tout de suite.
 */
@Directive({ selector: '.fade-up, .fade-left, .fade-right, .zoom-in' })
export class Reveal {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return; }
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { el.classList.add('in'); io.disconnect(); }
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      io.observe(el);
      destroyRef.onDestroy(() => io.disconnect());
    });
  }
}
