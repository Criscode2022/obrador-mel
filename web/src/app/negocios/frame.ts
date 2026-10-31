import { Component, inject, input } from '@angular/core';
import { Icon } from '../icon';
import { BizProfile } from './biz-types';
import { BizUi } from './biz-ui';
import { BizChat } from './chat';
import { BizStaff } from './staff';

// Marco de la web: aviso de demostración, asistente y panel del local.
@Component({
  selector: 'biz-frame',
  imports: [BizChat, BizStaff, Icon],
  host: { '[class.staff-open]': 'ui.staffOpen()' },
  template: `
    <div class="bar">
      <p><span class="long"><strong>Demostración</strong> · </span>{{ profile().name }} es un negocio ficticio</p>
      <button type="button" class="staff" [attr.aria-pressed]="ui.staffOpen()" (click)="ui.toggleStaff()">
        <app-icon name="store" [size]="16" /> <span>Panel del local</span>
        @if (ui.pending()) { <b aria-label="pendientes">{{ ui.pending() }}</b> }
      </button>
    </div>
    <ng-content />
    <biz-chat [profile]="profile()" />
    <biz-staff [profile]="profile()" />
  `,
  styles: `
    :host { display: block; --bz-bar: 42px; transition: padding-right 0.25s ease; }
    .bar {
      position: sticky; top: 0; z-index: 80; height: var(--bz-bar);
      display: flex; align-items: center; gap: 14px; padding: 0 max(14px, env(safe-area-inset-left));
      background: #15151a; color: #e9e9ee; font: 13px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    .bar p { margin: 0; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #b9b9c4; }
    .bar strong { color: #fff; }
    .staff {
      flex: none; display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px;
      border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 99px; background: transparent; color: #fff; font: inherit; font-weight: 600; cursor: pointer;
    }
    .staff:hover, .staff[aria-pressed='true'] { background: #fff; color: #15151a; }
    .staff b { min-width: 18px; height: 18px; padding: 0 5px; display: grid; place-items: center; border-radius: 99px; background: #ffb020; color: #1b1300; font-size: 11.5px; }
    .staff:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
    @media (max-width: 720px) { .long { display: none; } .bar { gap: 10px; } .bar p { font-size: 12px; } }
    @media (min-width: 1100px) { :host(.staff-open) { padding-right: min(470px, 100vw); } :host(.staff-open) .bar { right: min(470px, 100vw); } }
  `,
})
export class BizFrame {
  readonly profile = input.required<BizProfile>();
  protected readonly ui = inject(BizUi);
}
