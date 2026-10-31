import { Injectable, signal } from '@angular/core';
import { ChatAction } from './biz-types';

// Estado compartido entre la web del negocio, el asistente y el panel del local.
// La web pide cosas al asistente («Encargar una tarta») con `ask`.
export interface AskRequest {
  nonce: number;
  text?: string;
  action?: ChatAction;
  label?: string;
}

@Injectable({ providedIn: 'root' })
export class BizUi {
  readonly chatOpen = signal(false);
  readonly staffOpen = signal(false);
  readonly pending = signal(0);
  readonly request = signal<AskRequest | null>(null);
  private nonce = 0;

  openChat(): void {
    this.chatOpen.set(true);
  }

  ask(what: { text?: string; action?: ChatAction; label?: string }): void {
    this.chatOpen.set(true);
    this.request.set({ nonce: ++this.nonce, ...what });
  }

  toggleStaff(): void {
    this.staffOpen.update((v) => !v);
  }
}
