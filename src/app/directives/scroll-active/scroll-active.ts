import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

/**
 * Sur une liste `.pf-scroll` : quand la ligne choisie change (ex. un point cliqué
 * sur la carte), fait défiler la liste — et elle seule, jamais la page — jusqu'à
 * la ligne `.on`. Usage : `<div class="pf-scroll" [pfScrollActive]="sel()">`.
 */
@Directive({ selector: '[pfScrollActive]' })
export class ScrollActive {
  /** Clé de la ligne choisie ; sa valeur ne sert qu'à déclencher le défilement. */
  readonly pfScrollActive = input<unknown>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterRenderEffect(() => {
      if (this.pfScrollActive() == null) return;
      const box = this.host.nativeElement;
      const row = box.querySelector<HTMLElement>(':scope > .on');
      if (!row || box.scrollHeight <= box.clientHeight) return;
      // `.pf-scroll` est en position relative : offsetTop est mesuré depuis le haut de la liste.
      const top = row.offsetTop - 8;
      const bottom = row.offsetTop + row.offsetHeight + 8;
      let target: number | null = null;
      if (top < box.scrollTop) target = top;
      else if (bottom > box.scrollTop + box.clientHeight) target = Math.min(top, bottom - box.clientHeight);
      if (target === null) return;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      box.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' });
    });
  }
}
