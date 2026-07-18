import { AfterViewInit, Directive, ElementRef } from '@angular/core';

/** Foca (e seleciona o texto de) um input/textarea assim que ele entra no DOM —
 * usado nos campos de edição inline que aparecem via `@if`, onde cada entrada em
 * modo de edição cria uma instância nova do elemento. */
@Directive({ selector: '[appFocusOnInit]', standalone: true })
export class FocusOnInitDirective implements AfterViewInit {
  constructor(private el: ElementRef<HTMLInputElement>) {}

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.el.nativeElement.focus();
      this.el.nativeElement.select();
    });
  }
}
