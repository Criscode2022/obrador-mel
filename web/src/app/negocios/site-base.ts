import { signal } from '@angular/core';
import { inject } from '@angular/core';
import { BizApi } from './biz-api';
import { BizProfile } from './biz-types';
import { hoursRows } from './biz-format';
import { BizUi } from './biz-ui';

// Lo común a la web de un negocio: cargar el perfil (carta, horario, reglas) del motor.
export abstract class SiteBase {
  protected readonly api = inject(BizApi);
  protected readonly ui = inject(BizUi);
  protected readonly profile = signal<BizProfile | null>(null);
  protected readonly failed = signal(false);

  protected constructor(private readonly slug: string) {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.failed.set(false);
    try {
      this.profile.set(await this.api.profile(this.slug));
    } catch {
      this.failed.set(true);
    }
  }

  protected hours(p: BizProfile) {
    return hoursRows(p.hours as Record<string, [string, string][]>);
  }

  protected ask(text: string): void {
    this.ui.ask({ text });
  }

  protected start(intent: 'order' | 'booking', label: string): void {
    this.ui.ask({ action: { type: 'start', intent }, label });
  }
}
