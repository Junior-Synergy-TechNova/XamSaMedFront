import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Icon } from '../icon/icon';

/** Valeur décomposée pour l'animation : « 12 500 FCFA » → 12500, préfixe '', suffixe ' FCFA', 0 décimale. */
interface Parsed { n: number; prefix: string; suffix: string; decimals: number; grouped: boolean; }

function parse(v: string | number): Parsed | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const dec = (String(v).split('.')[1] ?? '').length;
    return { n: v, prefix: '', suffix: '', decimals: dec, grouped: false };
  }
  const m = /^(\D*?)(-?\d[\d\s  ]*(?:[.,]\d+)?)(.*)$/s.exec(v);
  if (!m) return null;
  const raw = m[2].replace(/[\s  ]/g, '');
  const dec = (raw.split(/[.,]/)[1] ?? '').length;
  const n = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return { n, prefix: m[1], suffix: m[3], decimals: dec, grouped: /[\s  ]/.test(m[2].trim()) };
}

/* Cellule d'indicateur (libellé + valeur + delta) — s'insère dans la bande .pf-statgrid */
@Component({
  selector: 'pf-stat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './stat.html',
  styleUrl: './stat.css',
})
export class Stat {
  readonly icon = input.required<string>();
  readonly label = input('');
  readonly value = input<string | number>('');
  readonly delta = input('');
  readonly deltaUp = input(false);
  readonly tone = input<'blue' | 'green' | 'red' | 'amber'>('blue');
  /** Un indicateur rouge / orange n'attire l'œil que s'il y a quelque chose à traiter. */
  readonly attention = computed(() => {
    const v = this.value();
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, ''));
    return (this.tone() === 'red' || this.tone() === 'amber') && !(n === 0);
  });

  /**
   * Valeur affichée : compte jusqu'à la nouvelle valeur (0,9 s, décélération) au lieu d'apparaître d'un coup —
   * depuis 0 au premier affichage, depuis l'ancienne valeur ensuite. Les lecteurs d'écran lisent `value()`
   * (texte masqué), jamais les valeurs intermédiaires. Rien d'animé si « réduire les animations ».
   */
  readonly shown = signal<string>('');
  private from = 0;
  private raf = 0;

  constructor() {
    effect(() => {
      const v = this.value();
      untracked(() => this.animateTo(v));
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private animateTo(v: string | number): void {
    this.stop();
    const target = parse(v);
    const reduce = typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!target || reduce || typeof requestAnimationFrame !== 'function' || target.n === this.from) {
      this.shown.set(String(v));
      if (target) this.from = target.n;
      return;
    }
    const start = performance.now();
    const from = this.from;
    const duration = 900;
    const fmt = (n: number) => target.grouped
      ? n.toLocaleString('fr-FR', { minimumFractionDigits: target.decimals, maximumFractionDigits: target.decimals })
      : target.decimals ? n.toFixed(target.decimals).replace('.', typeof v === 'string' && v.includes(',') ? ',' : '.') : String(Math.round(n));
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p >= 1) { this.shown.set(String(v)); this.from = target.n; return; }
      // Position courante gardée : une nouvelle valeur en cours d'animation repart d'ici, sans saut.
      this.from = from + (target.n - from) * eased;
      this.shown.set(target.prefix + fmt(this.from) + target.suffix);
      this.raf = requestAnimationFrame(step);
    };
    this.shown.set(target.prefix + fmt(from) + target.suffix);
    this.raf = requestAnimationFrame(step);
  }

  private stop(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
