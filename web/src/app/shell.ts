import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Raíz de la aplicación: solo el enrutador.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class Shell {}
