// Contratos entre la web y el motor (/api -> /biz).

export type Capability = 'info' | 'booking' | 'order';
export type Lang = 'es' | 'gl';

export type HourRange = [string, string];

export interface CatalogItem {
  id: string;
  category: string;
  name: string;
  price_cents: number;
  price_from: boolean;
  description: string;
  tags: string[];
  contains: string[];
  options: string[];
  duration: number | null;
  popular: boolean;
  note: string;
  lead_hours: number | null;
}

export interface CatalogCategory {
  id: string;
  name: string;
  note?: string;
  skip_diet?: boolean;
}

export interface OptionGroup {
  name: string;
  default?: string;
  required?: boolean;
  question?: { es: string; gl: string };
  choices: { id: string; name: string; delta: number }[];
}

export interface BizProfile {
  slug: string;
  name: string;
  label: string;
  kind: string;
  tagline: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  capabilities: Capability[];
  hours: Record<string, HourRange[]>;
  closed_dates: string[];
  assistant: {
    tone?: string;
    greeting: { es: string; gl: string };
    suggestions: string[];
    quick_actions: { label: string; text: string }[];
  };
  booking: {
    mode: 'tables' | 'staff';
    party: { min: number; max: number; handoff_over?: number } | null;
    horizon_days: number | null;
    resources: { id: string; name: string; role: string }[];
  } | null;
  order: { prep_minutes: number; horizon_days: number; pay: { es: string; gl: string }; need_phone: boolean } | null;
  catalog: { categories: CatalogCategory[]; options: Record<string, OptionGroup>; items: CatalogItem[] };
}

// ---------------------------------------------------------------- conversación

export interface ChatAction {
  type: string;
  [key: string]: string | number | undefined;
}

export interface Chip {
  label: string;
  text?: string;
  action?: ChatAction;
}

export interface Cite {
  title: string;
  source: string;
  heading?: string;
  quote?: string;
}

export interface Evidence {
  step: string;
  ok: boolean;
  detail: string;
}

export interface HoursCard { type: 'hours'; title: string; rows: { label: string; value: string; today?: boolean }[] }
export interface MenuCard { type: 'menu'; title: string; rows: { id: string; name: string; price_cents: number; price_from?: boolean; note?: string }[] }
export interface DetailCard {
  type: 'booking' | 'order';
  status: 'draft' | 'pending' | 'confirmed' | 'denied' | 'change_proposed';
  title: string;
  rows: { label: string; value: string }[];
  lines?: { index: number; item_id: string; name: string; qty: number; option: string; unit_cents: number; total_cents: number }[];
  total_cents?: number;
  pay?: string;
}
export type Card = HoursCard | MenuCard | DetailCard;

export interface ReplyMeta {
  chips?: Chip[];
  cards?: Card[];
  cites?: Cite[];
  evidence?: Evidence[];
  action?: ChatAction;
  redacted?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'staff';
  text: string;
  meta: ReplyMeta | null;
  at: string;
}

export type RequestKind = 'inquiry' | 'info' | 'booking' | 'order' | 'handoff' | 'question';
export type RequestStatus = 'collecting' | 'pending' | 'confirmed' | 'denied' | 'change_proposed' | 'answered' | 'reviewed' | 'cancelled';

export interface BizRequest {
  id: string;
  case_id: string;
  kind: RequestKind;
  status: RequestStatus;
  data: Record<string, any>;
  slot_start: string | null;
  slot_end: string | null;
  total_cents: number | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatResponse {
  case_id: string;
  mode: string;
  state: string;
  lang?: string;
  user: { id: string; at: string };
  replies: ChatMessage[];
  request: BizRequest | null;
  trace: Evidence[];
}

export interface ConversationResponse {
  case_id: string | null;
  state?: string;
  lang?: string;
  messages: ChatMessage[];
  request: BizRequest | null;
  asides?: BizRequest[];
}

// ------------------------------------------------------------------------------ local

export interface StaffRequest extends BizRequest {
  case_state: string;
  lang: string;
  customer_text: string;
  thread: { role: string; text: string; at: string }[];
  evidence: Evidence[];
  citations: { source: string; quote: string; score: number }[];
}

export interface StaffResponse {
  requests: StaffRequest[];
  counts: { pending: number; review: number; done: number };
}

export interface Slot {
  time: string;
  min: number;
  seats?: number;
  free?: number;
  scarce?: boolean;
  resource?: { id: string; name: string };
  left?: number;
}

export interface SlotsResponse { ok: boolean; reason: string | null; slots: Slot[] }

export interface Agenda {
  ymd: string;
  open: boolean;
  kind: 'closed' | 'tables' | 'staff' | 'pickup' | 'none';
  ranges: { from: string; to: string; from_min: number; to_min: number }[];
  rows?: { time: string; min: number; taken: number; mine: number; total: number }[];
  resources?: {
    id: string; name: string; role: string;
    ranges: { from_min: number; to_min: number }[];
    busy: { from_min: number; to_min: number }[];
    mine: { from_min: number; to_min: number }[];
  }[];
}
