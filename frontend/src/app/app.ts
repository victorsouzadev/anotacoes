import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Injetado só para instanciar o serviço cedo (aplica o tema salvo antes da 1ª pintura).
  constructor(private theme: ThemeService) {}
}
