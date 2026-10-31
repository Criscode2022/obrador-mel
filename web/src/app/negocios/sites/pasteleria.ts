import { Component, computed } from '@angular/core';
import { Icon } from '../../icon';
import { BizArt } from '../art';
import { euro } from '../biz-format';
import { CatalogItem } from '../biz-types';
import { BizFrame } from '../frame';
import { SiteBase } from '../site-base';

@Component({
  selector: 'site-pasteleria',
  imports: [BizFrame, BizArt, Icon],
  templateUrl: './pasteleria.html',
  styleUrl: './pasteleria.scss',
})
export class PasteleriaSite extends SiteBase {
  protected readonly euro = euro;
  protected readonly tiles = ['#f9d9dc', '#fbe7b6', '#e9dff3', '#d8ecdf', '#fbd9c4', '#ffe9ee'];
  protected readonly glyphs = ['slice', 'macaron', 'bread', 'leaf', 'drop', 'heart'];
  protected readonly tartas = computed<CatalogItem[]>(() => this.profile()?.catalog.items.filter((i) => i.category === 'tartas' && i.id !== 'bizcocho-yogur') ?? []);

  constructor() {
    super('pasteleria');
  }

  protected order(i: CatalogItem): void {
    this.ui.ask({ action: { type: 'add', item_id: i.id }, label: `Encargar: ${i.name}` });
  }
}
