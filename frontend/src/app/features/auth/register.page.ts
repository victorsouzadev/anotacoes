import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <button class="theme-toggle" (click)="theme.cycle()" [title]="themeLabel()">{{ themeIcon() }}</button>
      <div class="brand">
        <span class="brand-mark">✎</span>
        <span>Notas</span>
      </div>
      <form class="card" (ngSubmit)="submit()">
        <h1>Criar conta</h1>
        <p class="subtitle">Leva menos de um minuto.</p>
        <label>
          E-mail
          <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" placeholder="voce@email.com" />
        </label>
        <label>
          Senha (mín. 8 caracteres)
          <input type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password" placeholder="••••••••" />
        </label>
        @if (error) {
          <p class="error">{{ error }}</p>
        }
        <button type="submit" [disabled]="loading">{{ loading ? 'Criando…' : 'Criar conta' }}</button>
        <p class="switch">Já tem conta? <a routerLink="/login">Entrar</a></p>
      </form>
    </div>
  `,
  styles: [`
    .auth-page {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 28px;
      min-height: 100dvh;
      padding: 24px;
      background:
        radial-gradient(circle at 15% 15%, rgba(109, 94, 248, 0.14), transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(109, 94, 248, 0.10), transparent 40%),
        var(--bg);
    }
    .theme-toggle {
      position: absolute;
      top: 20px; right: 20px;
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: var(--radius-sm);
      width: 34px; height: 34px;
      font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: var(--shadow-sm);
    }
    .theme-toggle:hover { border-color: var(--accent); }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 18px; color: var(--text); }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 10px;
      background: var(--accent); color: #fff; font-size: 15px;
      box-shadow: var(--shadow-sm);
    }
    .card {
      background: var(--surface);
      padding: 32px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: var(--shadow-lg);
    }
    h1 { margin: 0; font-size: 21px; letter-spacing: -0.01em; }
    .subtitle { margin: -8px 0 4px; font-size: 13px; color: var(--text-muted); }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); font-weight: 500; }
    input {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-size: 14px;
      background: var(--bg);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }
    button[type=submit] {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm);
      padding: 11px;
      font-weight: 600;
      font-size: 14px;
      margin-top: 4px;
      transition: background 0.15s, transform 0.1s;
    }
    button[type=submit]:hover:not(:disabled) { background: var(--accent-dark); }
    button[type=submit]:active:not(:disabled) { transform: scale(0.98); }
    button[type=submit]:disabled { opacity: 0.6; cursor: default; }
    .error {
      color: var(--danger);
      background: rgba(229, 72, 77, 0.1);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      font-size: 13px;
      margin: 0;
    }
    .switch { font-size: 13px; text-align: center; margin: 4px 0 0; color: var(--text-muted); }
    .switch a { color: var(--accent); font-weight: 600; text-decoration: none; }
    .switch a:hover { text-decoration: underline; }
  `],
})
export class RegisterPageComponent {
  email = '';
  password = '';
  loading = false;
  error = '';

  constructor(private auth: AuthService, private router: Router, public theme: ThemeService) {}

  themeIcon(): string {
    switch (this.theme.pref()) {
      case 'dark': return '🌙';
      case 'light': return '☀️';
      default: return '🖥️';
    }
  }

  themeLabel(): string {
    switch (this.theme.pref()) {
      case 'dark': return 'Tema: escuro (clique para claro)';
      case 'light': return 'Tema: claro (clique para automático)';
      default: return 'Tema: automático (clique para escuro)';
    }
  }

  async submit(): Promise<void> {
    this.error = '';
    this.loading = true;
    try {
      await this.auth.register(this.email, this.password);
      this.router.navigateByUrl('/notes');
    } catch (e: any) {
      this.error = e?.error?.error ?? 'Não foi possível criar a conta.';
    } finally {
      this.loading = false;
    }
  }
}
