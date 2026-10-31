import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import {
  Agenda, BizProfile, ChatAction, ChatResponse, ConversationResponse, SlotsResponse, StaffResponse,
} from './biz-types';

const SESSION_KEY = 'obrador-session';
const caseKey = (slug: string) => `obrador-case-${slug}`;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Cada navegador tiene su propia sesión de demostración: nadie ve lo que prueba otra persona.
@Injectable({ providedIn: 'root' })
export class BizApi {
  private readonly http = inject(HttpClient);
  private memory = new Map<string, string>();

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? this.memory.get(key) ?? null;
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  private write(key: string, value: string | null): void {
    if (value == null) this.memory.delete(key);
    else this.memory.set(key, value);
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Sin almacenamiento (ventana privada): la sesión dura lo que la pestaña.
    }
  }

  get session(): string {
    let s = this.read(SESSION_KEY);
    if (!s || !/^[a-f0-9]{32}$/.test(s)) {
      s = randomHex(16);
      this.write(SESSION_KEY, s);
    }
    return s;
  }

  caseId(slug: string): string | null {
    return this.read(caseKey(slug));
  }

  setCase(slug: string, id: string | null): void {
    this.write(caseKey(slug), id);
  }

  warm(): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/warm', {}).pipe(timeout(5000)));
  }

  profile(slug: string): Promise<BizProfile> {
    return firstValueFrom(this.http.get<BizProfile>(`/api/${slug}`).pipe(timeout(15000)));
  }

  chat(slug: string, body: { text?: string; action?: ChatAction; label?: string }): Promise<ChatResponse> {
    return firstValueFrom(
      this.http.post<ChatResponse>(`/api/${slug}/chat`, { session: this.session, case_id: this.caseId(slug) ?? undefined, ...body }).pipe(timeout(60000)),
    );
  }

  conversation(slug: string): Promise<ConversationResponse> {
    const id = this.caseId(slug);
    const q = `session=${this.session}${id ? `&case=${id}` : ''}`;
    return firstValueFrom(this.http.get<ConversationResponse>(`/api/${slug}/conversation?${q}`).pipe(timeout(15000)));
  }

  staff(slug: string): Promise<StaffResponse> {
    return firstValueFrom(this.http.get<StaffResponse>(`/api/${slug}/staff?session=${this.session}`).pipe(timeout(15000)));
  }

  act(slug: string, body: { request_id: string; action: string; message?: string; date?: string; time?: string }): Promise<{ ok: boolean; status: string; message?: string }> {
    return firstValueFrom(this.http.post<{ ok: boolean; status: string; message?: string }>(`/api/${slug}/staff/act`, { session: this.session, ...body }).pipe(timeout(30000)));
  }

  agenda(slug: string, date: string): Promise<Agenda> {
    return firstValueFrom(this.http.get<Agenda>(`/api/${slug}/agenda?session=${this.session}&date=${date}`).pipe(timeout(15000)));
  }

  slots(slug: string, params: { date: string; party?: number; services?: string[]; resource?: string | null }): Promise<SlotsResponse> {
    const q = new URLSearchParams({ date: params.date });
    if (params.party) q.set('party', String(params.party));
    if (params.services?.length) q.set('services', params.services.join(','));
    if (params.resource) q.set('resource', params.resource);
    return firstValueFrom(this.http.get<SlotsResponse>(`/api/${slug}/slots?${q}`).pipe(timeout(15000)));
  }
}
