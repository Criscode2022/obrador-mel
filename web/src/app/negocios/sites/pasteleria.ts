import { Component } from '@angular/core';
import { Icon } from '../../icon';
import { BizArt } from '../art';
import { BizFrame } from '../frame';
import { SiteBase } from '../site-base';

@Component({
  selector: 'site-pasteleria',
  imports: [BizFrame, BizArt, Icon],
  templateUrl: './pasteleria.html',
  styleUrl: './pasteleria.scss',
})
export class PasteleriaSite extends SiteBase {
  constructor() {
    super('pasteleria');
  }
}
