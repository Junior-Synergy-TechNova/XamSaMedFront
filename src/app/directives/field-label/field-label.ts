import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

let nextId = 0;

/* Relie le libellé d'un champ `.s-field` à son contrôle (`for` / `id`) :
   le lecteur d'écran annonce le nom du champ et un clic sur le libellé y place le focus.
   Le contrôle peut apparaître après coup (`@if`) : un MutationObserver refait le lien.
   Les groupes de cases à cocher / boutons radio ne sont pas concernés. */
@Directive({ selector: '.s-field' })
export class FieldLabel implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer?: MutationObserver;

  ngAfterViewInit(): void {
    this.link();
    this.observer = new MutationObserver(() => this.link());
    this.observer.observe(this.host, { childList: true, subtree: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private link(): void {
    const label = this.host.querySelector<HTMLLabelElement>(':scope > label');
    const control = this.host.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea',
    );
    if (!label || !control || label.contains(control)) return;
    control.id ||= `pf-field-${++nextId}`;
    if (label.htmlFor !== control.id) label.htmlFor = control.id;
  }
}
