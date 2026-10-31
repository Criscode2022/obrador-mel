import { Component, computed, input } from '@angular/core';

// Iconos de trazo propios (24×24, sin relleno). Un nombre, un path; sin fuentes externas.
const ICONS: Record<string, string> = {
  alert: 'M12 4 21 20H3L12 4zM12 10v4.5M12 17.4v.1',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  bag: 'M6 8h12l1 12H5L6 8zM9 8a3 3 0 0 1 6 0',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6',
  cake: 'M4 20h16M5 20v-6h14v6M5 14c2 0 2-2 3.5-2S11 14 12 14s2-2 3.5-2S17 14 19 14M12 12V8M12 5.5c1-1.2 0-2 0-2s-1 .8 0 2z',
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V4.5a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V14c0 3.9-2.6 7-6.5 7-2.4 0-3.9-1-5.3-2.9L3.6 15.2a1.5 1.5 0 0 1 2.4-1.8L8 15.5',
  inbox: 'M3.5 13h5l1.5 2.5h4L15.5 13h5M6 5h12l2.5 8v5.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V13L6 5z',
  info: 'M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  minus: 'M5 12h14',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  pin: 'M12 21s6.5-5.4 6.5-11a6.5 6.5 0 1 0-13 0c0 5.6 6.5 11 6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 12a8 8 0 1 1-2.35-5.65M20 4.5V9h-4.5',
  send: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  shield: 'M12 3l7.5 3v5.5c0 4.4-3.1 8.1-7.5 9.5-4.4-1.4-7.5-5.1-7.5-9.5V6L12 3z',
  store: 'M4 10l1-5h14l1 5M4 10v9h16v-9M4 10a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 19v-5h4v5',
  utensils: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 4-3 7v3h3v8',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
};

@Component({
  selector: 'app-icon',
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    [attr.stroke-width]="stroke()" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path [attr.d]="d()" /></svg>`,
  styles: `:host { display: inline-flex; flex: none; line-height: 0; } svg { display: block; }`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(18);
  readonly stroke = input(1.75);
  protected readonly d = computed(() => ICONS[this.name()] ?? '');
}
