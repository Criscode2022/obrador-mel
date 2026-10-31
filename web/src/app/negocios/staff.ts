import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Icon } from '../icon';
import { BizApi } from './biz-api';
import {
  addDays, dayLabel, dayShort, euro, minToTime, statusView, ymdToday,
} from './biz-format';
import {
  Agenda, BizProfile, Slot, StaffRequest,
} from './biz-types';
import { BizUi } from './biz-ui';

type Tab = 'open' | 'agenda' | 'done';
type Form = 'change' | 'deny' | 'message' | null;

// Lo que vería una persona del negocio. Aquí se decide: el asistente prepara y comprueba, y solo
// cuando alguien confirma hay un evento de calendario y un expediente cerrado.
@Component({
  selector: 'biz-staff',
  imports: [Icon, NgTemplateOutlet],
  templateUrl: './staff.html',
  styleUrl: './staff.scss',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class BizStaff implements OnInit, OnDestroy {
  readonly profile = input.required<BizProfile>();
  protected readonly ui = inject(BizUi);
  private readonly api = inject(BizApi);

  protected readonly tab = signal<Tab>('open');
  protected readonly data = signal<{ requests: StaffRequest[]; counts: { pending: number; review: number; done: number } } | null>(null);
  protected readonly error = signal('');
  protected readonly acting = signal('');
  protected readonly toast = signal('');
  protected readonly forms = signal<Record<string, Form>>({});
  protected readonly drafts = signal<Record<string, string>>({});
  protected readonly changeDay = signal<Record<string, string>>({});
  protected readonly changeSlots = signal<Record<string, Slot[]>>({});
  protected readonly pickedSlot = signal<Record<string, string>>({});

  protected readonly agendaDay = signal(ymdToday());
  protected readonly agenda = signal<Agenda | null>(null);
  protected readonly agendaError = signal('');

  private poll: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly requests = computed(() => this.data()?.requests ?? []);
  protected readonly openList = computed(() => this.requests().filter((r) => this.isOpen(r)));
  protected readonly doneList = computed(() => this.requests().filter((r) => !this.isOpen(r)));
  protected readonly days = computed(() => {
    const out: string[] = [];
    const today = ymdToday();
    const horizon = Math.min(14, this.profile().booking?.horizon_days ?? this.profile().order?.horizon_days ?? 14);
    for (let i = 0; i <= Math.max(6, horizon); i += 1) out.push(addDays(today, i));
    return out.slice(0, 10);
  });
  protected readonly euro = euro;
  protected readonly statusView = statusView;

  constructor() {
    effect(() => {
      const open = this.ui.staffOpen();
      untracked(() => {
        if (open) {
          void this.refresh();
          void this.loadAgenda();
        }
      });
    });
    this.poll = setInterval(() => void this.refresh(), 3000);
  }

  ngOnInit(): void {
    void this.refresh();
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  protected onEscape(): void {
    if (this.ui.staffOpen()) this.ui.staffOpen.set(false);
  }

  protected isOpen(r: StaffRequest): boolean {
    return ['pending', 'change_proposed'].includes(r.status) || (r.kind === 'info' && r.status === 'answered');
  }

  async refresh(): Promise<void> {
    try {
      const d = await this.api.staff(this.profile().slug);
      this.data.set(d);
      this.ui.pending.set(d.counts.pending);
      this.error.set('');
    } catch {
      this.error.set('No se puede leer el panel ahora mismo.');
    }
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    if (tab === 'agenda') void this.loadAgenda();
  }

  // ---------------------------------------------------------------------- descripción

  protected title(r: StaffRequest): string {
    const d = r.data;
    switch (r.kind) {
      case 'booking':
        if (d['mode'] === 'staff') return `Cita · ${(d['services'] ?? []).map((s: { name: string }) => s.name).join(' + ')}`;
        return `Reserva de mesa · ${d['party']} ${d['party'] === 1 ? 'persona' : 'personas'}`;
      case 'order': {
        const n = (d['lines'] ?? []).reduce((a: number, l: { qty: number }) => a + l.qty, 0);
        return `Pedido · ${n} ${n === 1 ? 'producto' : 'productos'} · ${euro(r.total_cents)}`;
      }
      case 'handoff':
        return d['reason'] === 'group' ? 'Grupo grande: lo lleva una persona' : d['reason'] === 'change_request' ? 'Cambio o cancelación pedido por el cliente' : 'El cliente quiere hablar con una persona';
      case 'question':
        return 'Pregunta que el asistente no sabe responder';
      default:
        return 'Consulta respondida por el asistente';
    }
  }

  protected when(r: StaffRequest): string {
    const d = r.data;
    const p = d['proposed'];
    const ymd = r.status === 'change_proposed' && p ? p.ymd : d['ymd'];
    const time = r.status === 'change_proposed' && p ? p.time : d['time'];
    return ymd ? `${dayLabel(ymd)} · ${time}` : '';
  }

  protected rows(r: StaffRequest): { label: string; value: string }[] {
    const d = r.data;
    const out: { label: string; value: string }[] = [];
    if (d['name']) out.push({ label: 'A nombre de', value: d['name'] });
    if (d['phone']) out.push({ label: 'Teléfono', value: d['phone'] });
    if (d['resource']?.name) out.push({ label: 'Con', value: d['resource'].name });
    if (r.kind === 'booking' && d['duration']) out.push({ label: 'Duración', value: `${d['duration']} min` });
    if (d['note']) out.push({ label: 'Notas del cliente', value: d['note'] });
    if (r.kind === 'booking' && r.total_cents) out.push({ label: 'Importe orientativo', value: euro(r.total_cents) });
    if (r.kind === 'handoff' && d['party']) out.push({ label: 'Personas', value: String(d['party']) });
    if (r.kind === 'question' && d['question']) out.push({ label: 'Pregunta', value: d['question'] });
    return out;
  }

  protected icon(r: StaffRequest): string {
    const map: Record<string, string> = { booking: this.profile().booking?.mode === 'staff' ? 'calendar' : 'utensils', order: 'bag', handoff: 'hand', question: 'chat', info: 'info' };
    return map[r.kind] ?? 'file';
  }

  protected lines(r: StaffRequest): { qty: number; name: string; option_label: string; total_cents: number }[] {
    return r.data['lines'] ?? [];
  }

  protected tone(r: StaffRequest): string {
    return statusView(r)?.tone ?? 'info';
  }

  protected shortStatus(r: StaffRequest): string {
    return statusView(r)?.short ?? r.status;
  }

  // ------------------------------------------------------------------------- acciones

  protected form(r: StaffRequest): Form {
    return this.forms()[r.id] ?? null;
  }

  protected openForm(r: StaffRequest, form: Form): void {
    this.forms.update((f) => ({ ...f, [r.id]: f[r.id] === form ? null : form }));
    if (form === 'change') {
      const base = (r.data['ymd'] as string) || ymdToday();
      void this.pickDay(r, base);
    }
  }

  protected draft(r: StaffRequest): string {
    return this.drafts()[r.id] ?? '';
  }

  protected setDraft(r: StaffRequest, event: Event): void {
    const value = (event.target as HTMLTextAreaElement | HTMLInputElement).value;
    this.drafts.update((d) => ({ ...d, [r.id]: value }));
  }

  protected async pickDay(r: StaffRequest, ymd: string): Promise<void> {
    this.changeDay.update((d) => ({ ...d, [r.id]: ymd }));
    this.pickedSlot.update((p) => ({ ...p, [r.id]: '' }));
    try {
      const d = r.data;
      const res = await this.api.slots(this.profile().slug, {
        date: ymd,
        party: d['party'],
        services: (d['services'] ?? []).map((s: { id: string }) => s.id),
        resource: d['resource']?.id ?? null,
      });
      this.changeSlots.update((s) => ({ ...s, [r.id]: res.slots }));
    } catch {
      this.changeSlots.update((s) => ({ ...s, [r.id]: [] }));
    }
  }

  protected pick(r: StaffRequest, time: string): void {
    this.pickedSlot.update((p) => ({ ...p, [r.id]: time }));
  }

  protected async act(r: StaffRequest, action: 'accept' | 'deny' | 'change' | 'message' | 'review'): Promise<void> {
    if (this.acting()) return;
    this.acting.set(r.id);
    try {
      const body: { request_id: string; action: string; message?: string; date?: string; time?: string } = { request_id: r.id, action };
      if (action === 'change') {
        body.date = this.changeDay()[r.id];
        body.time = this.pickedSlot()[r.id];
        body.message = this.draft(r);
      } else if (action === 'deny' || action === 'message' || action === 'accept') {
        body.message = this.draft(r);
      }
      await this.api.act(this.profile().slug, body);
      this.say(
        { accept: 'Confirmado. El cliente lo ve ahora en el chat.', deny: 'Rechazado. El cliente ha recibido el aviso.', change: 'Propuesta enviada al cliente.', message: 'Mensaje enviado al cliente.', review: 'Marcada como revisada.' }[action],
      );
      this.forms.update((f) => ({ ...f, [r.id]: null }));
      this.drafts.update((d) => ({ ...d, [r.id]: '' }));
      await this.refresh();
    } catch (err) {
      const e = err as { error?: { error?: string } };
      this.say(e.error?.error ?? 'No se ha podido completar.', true);
    } finally {
      this.acting.set('');
    }
  }

  private say(text: string, bad = false): void {
    this.toast.set(`${bad ? '!' : ''}${text}`);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 4200);
  }

  protected toastText(): string {
    return this.toast().replace(/^!/, '');
  }

  protected toastBad(): boolean {
    return this.toast().startsWith('!');
  }

  protected openChat(): void {
    this.ui.openChat();
    if (window.innerWidth < 1100) this.ui.staffOpen.set(false);
  }

  // ---------------------------------------------------------------------------- agenda

  protected async loadAgenda(day?: string): Promise<void> {
    if (day) this.agendaDay.set(day);
    try {
      this.agenda.set(await this.api.agenda(this.profile().slug, this.agendaDay()));
      this.agendaError.set('');
    } catch {
      this.agendaError.set('No se puede cargar la agenda.');
    }
  }

  protected dayShort = dayShort;
  protected dayLabel = dayLabel;
  protected minToTime = minToTime;

  protected span = computed(() => {
    const a = this.agenda();
    if (!a || a.kind !== 'staff' || !a.resources) return { start: 540, end: 1200 };
    const all = a.resources.flatMap((r) => r.ranges);
    if (!all.length) return { start: 540, end: 1200 };
    return { start: Math.min(...all.map((x) => x.from_min)), end: Math.max(...all.map((x) => x.to_min)) };
  });

  protected top(min: number): number {
    return (min - this.span().start) * 0.85;
  }

  protected height(from: number, to: number): number {
    return Math.max(6, (to - from) * 0.85);
  }

  protected total(): number {
    return (this.span().end - this.span().start) * 0.85;
  }

  protected hourMarks(): number[] {
    const { start, end } = this.span();
    const out: number[] = [];
    for (let m = Math.ceil(start / 60) * 60; m < end; m += 60) out.push(m);
    return out;
  }

  protected pct(a: number, b: number): number {
    return Math.min(100, Math.round((a / Math.max(1, b)) * 100));
  }
}
