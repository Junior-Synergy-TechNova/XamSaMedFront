import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, inject, input, model, signal, viewChild, viewChildren,
} from '@angular/core';

export interface SegOption<T extends string = string> { id: T; label: string }

/**
 * Sélecteur segmenté (un seul choix) : un indicateur bleu glisse sous l'option choisie.
 * Accessible comme un groupe radio : flèches / Début / Fin déplacent la sélection.
 */
@Component({
  selector: 'pf-seg',
  templateUrl: './seg-control.html',
  styleUrl: './seg-control.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SegControl<T extends string = string> {
  readonly options = input.required<readonly SegOption<T>[]>();
  readonly value = model.required<T>();
  /** id de l'étiquette visible du groupe (aria-labelledby). */
  readonly labelledBy = input<string>();

  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');
  private readonly btns = viewChildren<ElementRef<HTMLButtonElement>>('btn');

  /** Position de l'indicateur (null tant qu'il n'est pas mesuré : le bouton actif garde alors son propre fond). */
  readonly ind = signal<{ x: number; w: number } | null>(null);
  /** Pas de glissement au premier affichage : l'indicateur apparaît directement en place. */
  readonly animated = signal(false);
  private readonly resized = signal(0);

  constructor() {
    afterRenderEffect({
      read: () => {
        this.resized();
        const i = this.options().findIndex(o => o.id === this.value());
        const btn = this.btns()[i]?.nativeElement;
        if (!btn || !btn.offsetWidth) return;
        const next = { x: btn.offsetLeft, w: btn.offsetWidth };
        const prev = this.ind();
        if (prev && prev.x === next.x && prev.w === next.w) return;
        this.animated.set(prev !== null);
        this.ind.set(next);
      },
    });

    // Polices chargées, largeur du panneau qui change… → on remesure sans animer.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { this.ind.set(null); this.resized.update(n => n + 1); });
      afterRenderEffect(() => { ro.disconnect(); ro.observe(this.track().nativeElement); });
      inject(DestroyRef).onDestroy(() => ro.disconnect());
    }
  }

  pick(id: T): void { this.value.set(id); }

  onKey(e: KeyboardEvent, i: number): void {
    const n = this.options().length;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    this.value.set(this.options()[to].id);
    const btn = this.btns()[to]?.nativeElement;
    btn?.focus();
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}
