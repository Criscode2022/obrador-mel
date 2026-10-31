import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

// Ilustraciones propias en vectores (no hay fotos: es un negocio ficticio). Usan las variables
// --a1..--a5 de la web que las pinta.
const HERO: Record<string, string> = {
  cake: `<svg viewBox="0 0 400 400" role="img" aria-label="Tarta de tres pisos con cerezas y macarons">
    <ellipse cx="200" cy="352" rx="170" ry="22" fill="var(--a5)"/><ellipse cx="200" cy="344" rx="150" ry="16" fill="var(--a3)" stroke="var(--a2)" stroke-opacity=".25" stroke-width="2"/>
    <rect x="76" y="262" width="248" height="82" rx="16" fill="var(--a5)"/>
    <path d="M76 286c14 0 14 18 28 18s14-18 28-18 14 18 28 18 14-18 28-18 14 18 28 18 14-18 28-18 14 18 28 18 14-18 28-18v-14a16 16 0 0 0-16-16H92a16 16 0 0 0-16 16z" fill="var(--a3)"/>
    <rect x="106" y="190" width="188" height="76" rx="16" fill="var(--a1)"/>
    <path d="M106 212c12 0 12 16 24 16s12-16 24-16 12 16 24 16 12-16 24-16 12 16 24 16 12-16 24-16 12 16 24 16v-12a16 16 0 0 0-16-16H122a16 16 0 0 0-16 16z" fill="var(--a3)"/>
    <rect x="136" y="124" width="128" height="70" rx="14" fill="var(--a2)"/>
    <path d="M136 146c10 0 10 14 20 14s10-14 20-14 10 14 20 14 10-14 20-14 10 14 20 14 10-14 20-14v-8a14 14 0 0 0-14-14H150a14 14 0 0 0-14 14z" fill="var(--a3)"/>
    <g fill="var(--a1)"><circle cx="176" cy="118" r="14"/><circle cx="204" cy="112" r="14"/><circle cx="230" cy="120" r="14"/></g>
    <g fill="#fff" opacity=".55"><circle cx="171" cy="113" r="4"/><circle cx="199" cy="107" r="4"/><circle cx="225" cy="115" r="4"/></g>
    <path d="M204 98c4-18 14-28 26-34" stroke="#5c7a3a" stroke-width="4" fill="none" stroke-linecap="round"/>
    <g><circle cx="58" cy="334" r="24" fill="var(--a1)"/><rect x="34" y="330" width="48" height="8" rx="4" fill="var(--a3)"/></g>
    <g><circle cx="344" cy="334" r="24" fill="var(--a2)"/><rect x="320" y="330" width="48" height="8" rx="4" fill="var(--a3)"/></g>
    <g fill="var(--a2)" opacity=".7"><rect x="88" y="150" width="10" height="4" rx="2" transform="rotate(30 93 152)"/><rect x="304" y="170" width="10" height="4" rx="2" transform="rotate(-30 309 172)"/><rect x="326" y="118" width="10" height="4" rx="2" transform="rotate(60 331 120)"/><rect x="70" y="210" width="10" height="4" rx="2" transform="rotate(-50 75 212)"/></g>
  </svg>`,
};

const SPOT: Record<string, string> = {
  slice: '<path d="M10 54V34h44v20z" fill="var(--a1)"/><path d="M10 38c6 0 6 8 11 8s6-8 11-8 6 8 11 8 6-8 11-8" stroke="var(--a3)" stroke-width="3" fill="none"/><path d="M32 30V16" stroke="var(--a2)" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="12" r="4" fill="var(--a2)"/>',
  macaron: '<ellipse cx="32" cy="22" rx="22" ry="11" fill="var(--a1)"/><rect x="12" y="28" width="40" height="6" rx="3" fill="var(--a3)"/><ellipse cx="32" cy="42" rx="22" ry="11" fill="var(--a1)"/>',
  bread: '<path d="M8 38c0-14 10-22 24-22s24 8 24 22v8H8z" fill="var(--a1)"/><path d="M22 24l6 12M34 22l6 14M44 26l4 10" stroke="var(--a3)" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>',
  leaf: '<path d="M10 54C8 24 28 8 56 8c0 28-16 48-44 46z" fill="var(--a1)"/><path d="M12 52C26 38 38 28 52 12" stroke="var(--a3)" stroke-width="2.5" fill="none" opacity=".7"/>',
  drop: '<path d="M32 6C22 22 14 30 14 40a18 18 0 0 0 36 0c0-10-8-18-18-34z" fill="var(--a1)"/>',
  heart: '<path d="M32 54C10 38 8 22 18 14c8-6 14 0 14 6 0-6 6-12 14-6 10 8 8 24-14 40z" fill="var(--a1)"/>',
};

@Component({
  selector: 'biz-art',
  template: `<span class="art" [innerHTML]="html()"></span>`,
  styles: `
    :host { display: block; line-height: 0; }
    .art { display: block; width: 100%; height: 100%; }
    .art ::ng-deep svg { display: block; width: 100%; height: 100%; }
  `,
})
export class BizArt {
  readonly kind = input.required<string>();
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly html = computed(() => {
    const k = this.kind();
    if (HERO[k]) return this.sanitizer.bypassSecurityTrustHtml(HERO[k]);
    const body = SPOT[k] ?? SPOT['leaf'];
    return this.sanitizer.bypassSecurityTrustHtml(`<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`);
  });
}
