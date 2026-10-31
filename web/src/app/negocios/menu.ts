import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Icon } from '../icon';
import { ALLERGEN_LABEL, TAG_LABEL, euro } from './biz-format';
import { BizProfile, CatalogItem } from './biz-types';
import { BizUi } from './biz-ui';

// Carta del negocio, con precios y alérgenos reales del catálogo.
// En modo «order» cada producto se añade al pedido desde el asistente; en «book», cada servicio
// abre una cita; en «view» solo se consulta.
@Component({
  selector: 'biz-menu',
  imports: [Icon, DecimalPipe],
  template: `
    @if (cats().length > 1) {
      <div class="tabs" role="tablist" [attr.aria-label]="label()">
        @for (c of cats(); track c.id) {
          <button type="button" role="tab" [attr.aria-selected]="active() === c.id" [class.on]="active() === c.id" (click)="active.set(c.id)">{{ c.name }}</button>
        }
      </div>
    }
    @if (current(); as c) {
      @if (c.note) { <p class="note">{{ c.note }}</p> }
    }
    <ul class="items" role="tabpanel">
      @for (i of items(); track i.id) {
        <li>
          <div class="main">
            <h4>{{ i.name }} @if (i.popular) { <span class="fav">Favorito</span> }</h4>
            @if (i.description) { <p class="desc">{{ i.description }}</p> }
            <p class="meta">
              @if (i.duration) { <span><app-icon name="clock" [size]="13" /> {{ duration(i.duration) }}</span> }
              @for (t of tags(i); track t) { <span class="tag">{{ t }}</span> }
              @if (showAllergens() && i.contains.length) { <span class="all">Contiene {{ allergens(i) }}</span> }
              @if (i.lead_hours && i.lead_hours >= 24) { <span>Encargo con {{ i.lead_hours / 24 | number: '1.0-0' }} {{ i.lead_hours / 24 === 1 ? 'día' : 'días' }}</span> }
            </p>
          </div>
          <div class="side">
            <span class="price">{{ euro(i.price_cents, i.price_from) }}</span>
            @if (mode() === 'order') {
              <button type="button" class="act" (click)="add(i)" [attr.aria-label]="'Añadir ' + i.name + ' al pedido'"><app-icon name="plus" [size]="15" [stroke]="2.2" /> <span>Añadir</span></button>
            } @else if (mode() === 'book' && i.duration) {
              <button type="button" class="act" (click)="book(i)" [attr.aria-label]="'Pedir cita para ' + i.name"><app-icon name="calendar" [size]="15" /> <span>Pedir cita</span></button>
            }
          </div>
        </li>
      }
    </ul>
  `,
  styleUrl: './menu.scss',
})
export class BizMenu {
  readonly profile = input.required<BizProfile>();
  readonly mode = input<'order' | 'book' | 'view'>('view');
  readonly showAllergens = input(false);
  readonly categories = input<string[] | null>(null);
  readonly label = input('Categorías');
  protected readonly euro = euro;
  private readonly ui = inject(BizUi);
  protected readonly active = signal('');

  protected readonly cats = computed(() => {
    const p = this.profile();
    const ids = this.categories();
    const used = new Set(p.catalog.items.map((i) => i.category));
    return p.catalog.categories.filter((c) => used.has(c.id) && (!ids || ids.includes(c.id)));
  });
  protected readonly current = computed(() => this.cats().find((c) => c.id === (this.active() || this.cats()[0]?.id)) ?? null);
  protected readonly items = computed(() => {
    const id = this.current()?.id;
    return this.profile().catalog.items.filter((i) => i.category === id);
  });

  protected tags(i: CatalogItem): string[] {
    return i.tags.filter((t) => !(t === 'vegetariano' && i.tags.includes('vegano'))).map((t) => TAG_LABEL[t]).filter(Boolean);
  }

  protected allergens(i: CatalogItem): string {
    return i.contains.map((a) => ALLERGEN_LABEL[a] ?? a).join(', ');
  }

  protected duration(min: number): string {
    return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
  }

  protected add(i: CatalogItem): void {
    this.ui.ask({ action: { type: 'add', item_id: i.id }, label: `Añadir: ${i.name}` });
  }

  protected book(i: CatalogItem): void {
    this.ui.ask({ action: { type: 'set', field: 'service', value: i.id }, label: `Cita para: ${i.name}` });
  }
}
