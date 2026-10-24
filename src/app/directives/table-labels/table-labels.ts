import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/* Recopie l'intitulé de chaque colonne (`<th>`) sur ses cellules (`data-label`).
   Sur téléphone, `styles.css` affiche alors chaque ligne en fiche « libellé : valeur »
   au lieu d'un tableau qui défile de côté et cache ses actions.
   Les lignes sont rendues par `@for` : un MutationObserver suit les ajouts. */
@Directive({ selector: 'table.pf-table' })
export class TableLabels implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLTableElement>>(ElementRef).nativeElement;
  private observer?: MutationObserver;

  ngAfterViewInit(): void {
    this.label();
    this.observer = new MutationObserver(() => this.label());
    this.observer.observe(this.host, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private label(): void {
    const headers = Array.from(this.host.querySelectorAll('thead th')).map(th => th.textContent?.trim() ?? '');
    for (const row of Array.from(this.host.querySelectorAll<HTMLTableRowElement>('tbody tr'))) {
      Array.from(row.cells).forEach((cell, i) => {
        if (cell.colSpan > 1) return;
        const label = headers[i] ?? '';
        if (cell.dataset['label'] !== label) cell.dataset['label'] = label;
      });
    }
  }
}
