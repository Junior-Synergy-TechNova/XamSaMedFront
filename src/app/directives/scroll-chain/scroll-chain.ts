import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** En dessous de ce delta (px), on considère un pavé tactile : son défilement natif est déjà continu. */
const WHEEL_MIN_DELTA = 50;
/** Sans `scrollend` (Safari), on oublie la cible après ce délai d'inactivité. */
const IDLE_RESET_MS = 600;

/**
 * Relais fluide liste → page. Arrivée au bout d'une liste `.pf-scroll`, la molette
 * passe à la page, mais Chrome applique ce reliquat d'un coup (la page « saute »).
 * Ici, quand la liste est déjà en butée dans le sens de la molette, on fait défiler
 * la page nous-mêmes avec une animation douce, en cumulant les crans successifs.
 * Posée une seule fois sur la racine du shell : toutes les listes en profitent.
 */
@Directive({ selector: '[pfScrollChain]' })
export class ScrollChain {
  private target: number | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const forget = () => { this.target = null; };

      const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        const list = e.target instanceof Element ? e.target.closest('.pf-scroll') : null;
        if (!(list instanceof HTMLElement) || list.scrollHeight <= list.clientHeight) return;
        const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1);
        if (Math.abs(dy) < WHEEL_MIN_DELTA) return;
        const atEdge = dy > 0
          ? list.scrollTop + list.clientHeight >= list.scrollHeight - 1
          : list.scrollTop <= 0;
        if (!atEdge) { forget(); return; }

        e.preventDefault();
        const max = document.documentElement.scrollHeight - window.innerHeight;
        this.target = Math.max(0, Math.min(max, (this.target ?? window.scrollY) + dy));
        window.scrollTo({ top: this.target, behavior: reduce ? 'auto' : 'smooth' });
        clearTimeout(this.idle);
        this.idle = setTimeout(forget, IDLE_RESET_MS);
      };

      host.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('scrollend', forget);
      destroyRef.onDestroy(() => {
        host.removeEventListener('wheel', onWheel);
        window.removeEventListener('scrollend', forget);
        clearTimeout(this.idle);
      });
    });
  }
}
