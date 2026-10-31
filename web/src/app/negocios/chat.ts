import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild, OnDestroy, OnInit } from '@angular/core';
import { Icon } from '../icon';
import { BizApi } from './biz-api';
import { euro, statusView } from './biz-format';
import {
  BizProfile, BizRequest, Card, ChatAction, ChatMessage, Chip,
} from './biz-types';
import { BizUi } from './biz-ui';

// El asistente del negocio. Habla con el motor por /api: lo que responde sale de la carta,
// el horario y los textos del negocio, y todo lo que compromete al local (una reserva, un pedido)
// queda pendiente de que lo confirme una persona desde el panel del local.
@Component({
  selector: 'biz-chat',
  imports: [Icon, NgTemplateOutlet],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class BizChat implements OnInit, OnDestroy {
  readonly profile = input.required<BizProfile>();
  protected readonly ui = inject(BizUi);
  private readonly api = inject(BizApi);

  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly request = signal<BizRequest | null>(null);
  protected readonly busy = signal(false);
  protected readonly slow = signal(false);
  protected readonly draft = signal('');
  protected readonly error = signal('');
  protected readonly unread = signal(0);
  protected readonly expanded = signal<Set<string>>(new Set());

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private restored = false;
  private lastAsk = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSent: { text?: string; action?: ChatAction; label?: string } | null = null;

  protected readonly status = computed(() => statusView(this.request()));
  protected readonly empty = computed(() => this.messages().length === 0);
  protected readonly initial = computed(() => this.profile().name.trim().charAt(0).toUpperCase());
  protected readonly lastCardMessage = computed(() => {
    const list = this.messages();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].meta?.cards?.some((c) => c.type === 'order' || c.type === 'booking')) return list[i].id;
    }
    return '';
  });
  protected readonly suggestions = computed(() => this.profile().assistant.suggestions.slice(0, 4));
  protected readonly quick = computed(() => this.profile().assistant.quick_actions.slice(0, 3));
  protected readonly euro = euro;

  constructor() {
    effect(() => {
      const req = this.ui.request();
      if (!req || req.nonce === this.lastAsk) return;
      this.lastAsk = req.nonce;
      untracked(() => void this.handleAsk(req));
    });
    effect(() => {
      if (this.ui.chatOpen()) {
        untracked(() => {
          this.unread.set(0);
          void this.api.warm().catch(() => undefined);
          void this.restore();
          setTimeout(() => this.field()?.nativeElement.focus({ preventScroll: true }), 120);
        });
      }
    });
    effect(() => {
      this.messages();
      this.busy();
      untracked(() => this.scrollEnd());
    });
    effect(() => {
      const r = this.request();
      const active = r && (r.status === 'pending' || r.status === 'change_proposed');
      untracked(() => (active ? this.startPoll() : this.stopPoll()));
    });
  }

  ngOnInit(): void {
    void this.restore(true);
  }

  ngOnDestroy(): void {
    this.stopPoll();
    if (this.slowTimer) clearTimeout(this.slowTimer);
  }

  protected onEscape(): void {
    if (this.ui.chatOpen()) this.close();
  }

  protected close(): void {
    this.ui.chatOpen.set(false);
  }

  // Reanuda la conversación del navegador (si la hay) al abrir o recargar.
  private async restore(quiet = false): Promise<void> {
    if (this.restored) return;
    const slug = this.profile().slug;
    if (!this.api.caseId(slug)) {
      this.restored = true;
      return;
    }
    try {
      const c = await this.api.conversation(slug);
      this.restored = true;
      if (c.case_id) {
        this.messages.set(c.messages);
        this.request.set(c.request);
      } else {
        this.api.setCase(slug, null);
      }
    } catch {
      if (!quiet) this.error.set('No he podido recuperar la conversación anterior.');
    }
  }

  protected reset(): void {
    this.api.setCase(this.profile().slug, null);
    this.messages.set([]);
    this.request.set(null);
    this.error.set('');
    this.draft.set('');
    this.stopPoll();
    setTimeout(() => this.field()?.nativeElement.focus(), 50);
  }

  private async handleAsk(req: { text?: string; action?: ChatAction; label?: string }): Promise<void> {
    await this.restore();
    if (req.action) await this.sendAction(req.action, req.label);
    else if (req.text) await this.send(req.text);
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    // Se lee del campo, no de la señal: así vale aunque se pulse Enter justo al teclear.
    const input = this.field()?.nativeElement;
    const text = (input?.value ?? this.draft()).trim();
    if (!text || this.busy()) return;
    this.draft.set('');
    if (input) input.value = '';
    await this.send(text);
  }

  protected chip(c: Chip): void {
    if (this.busy()) return;
    if (c.action) void this.sendAction(c.action, c.label);
    else void this.send(c.text ?? c.label);
  }

  protected async sendAction(action: ChatAction, label?: string): Promise<void> {
    await this.run({ action, label }, label ?? '');
  }

  protected async send(text: string): Promise<void> {
    await this.run({ text }, text);
  }

  protected qty(index: number, delta: number): void {
    if (this.busy()) return;
    void this.run({ action: { type: 'qty', index, delta }, label: delta > 0 ? 'Una unidad más' : 'Una unidad menos' }, delta > 0 ? 'Una unidad más' : 'Una unidad menos');
  }

  private async run(body: { text?: string; action?: ChatAction; label?: string }, shown: string): Promise<void> {
    if (this.busy()) return;
    const slug = this.profile().slug;
    this.error.set('');
    this.lastSent = body;
    const tmp: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', text: shown, meta: null, at: new Date().toISOString() };
    this.messages.update((m) => [...m, tmp]);
    this.busy.set(true);
    this.slow.set(false);
    this.slowTimer = setTimeout(() => this.slow.set(true), 5000);
    try {
      const r = await this.api.chat(slug, body);
      this.api.setCase(slug, r.case_id);
      this.messages.update((list) => {
        const keep = list.filter((m) => m.id !== tmp.id);
        const fresh = r.replies.filter((x) => !keep.some((k) => k.id === x.id));
        return [...keep, { ...tmp, id: r.user.id, at: r.user.at }, ...fresh];
      });
      this.request.set(r.request);
    } catch (err) {
      this.messages.update((m) => m.filter((x) => x.id !== tmp.id));
      const e = err as { error?: { error?: string }; status?: number };
      this.error.set(e.error?.error ?? (e.status === 0 ? 'No hay conexión con el asistente.' : 'No he podido responder ahora mismo. Inténtalo de nuevo.'));
    } finally {
      this.busy.set(false);
      this.slow.set(false);
      if (this.slowTimer) clearTimeout(this.slowTimer);
    }
  }

  protected retry(): void {
    const body = this.lastSent;
    if (!body) return;
    this.error.set('');
    void this.run(body, body.label ?? body.text ?? '');
  }

  // Mientras el local no responda, se comprueba cada pocos segundos si hay novedades.
  private startPoll(): void {
    if (this.poll) return;
    this.poll = setInterval(() => void this.refresh(), 2500);
  }

  private stopPoll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  private async refresh(): Promise<void> {
    if (this.busy()) return;
    const slug = this.profile().slug;
    if (!this.api.caseId(slug)) return;
    try {
      const c = await this.api.conversation(slug);
      if (!c.case_id) return;
      const known = new Set(this.messages().map((m) => m.id));
      const fresh = c.messages.filter((m) => !known.has(m.id) && m.role !== 'user');
      if (fresh.length) {
        this.messages.update((list) => [...list, ...fresh]);
        if (!this.ui.chatOpen()) this.unread.update((n) => n + fresh.length);
      }
      this.request.set(c.request);
    } catch {
      // Un fallo suelto de red no corta el seguimiento.
    }
  }

  private scrollEnd(): void {
    requestAnimationFrame(() => {
      const el = this.log()?.nativeElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }

  protected toggleRows(id: string): void {
    this.expanded.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected isLatestCard(msg: ChatMessage, card: Card): boolean {
    return card.type === 'order' && card.status === 'draft' && msg.id === this.lastCardMessage() && !this.busy();
  }

  protected cardStatus(s: string): string {
    return { draft: 'Borrador', pending: 'Pendiente de confirmar', confirmed: 'Confirmada', denied: 'No confirmada', change_proposed: 'Cambio propuesto' }[s] ?? s;
  }

  protected fromLabel(m: ChatMessage): string {
    return m.role === 'staff' ? `${this.profile().name} · el local` : 'Asistente';
  }

  protected rowsOf(card: Card, id: string): { id: string; name: string; price_cents: number; price_from?: boolean; note?: string }[] {
    if (card.type !== 'menu') return [];
    return this.expanded().has(id) || card.rows.length <= 7 ? card.rows : card.rows.slice(0, 6);
  }
}
