import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const ACCESS_KEY = 'notas.accessToken';
const REFRESH_KEY = 'notas.refreshToken';
const USER_KEY = 'notas.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private accessToken = signal<string | null>(localStorage.getItem(ACCESS_KEY));
  private refreshTokenValue = signal<string | null>(localStorage.getItem(REFRESH_KEY));
  user = signal<AuthUser | null>(this.readStoredUser());

  isAuthenticated = computed(() => this.accessToken() !== null);

  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private http: HttpClient, private router: Router) {}

  private readStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  }

  getAccessToken(): string | null {
    return this.accessToken();
  }

  getRefreshToken(): string | null {
    return this.refreshTokenValue();
  }

  private persist(res: AuthResponse) {
    this.accessToken.set(res.accessToken);
    this.refreshTokenValue.set(res.refreshToken);
    this.user.set(res.user);
    localStorage.setItem(ACCESS_KEY, res.accessToken);
    localStorage.setItem(REFRESH_KEY, res.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  }

  async register(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<AuthResponse>('/api/auth/register', { email, password }),
    );
    this.persist(res);
  }

  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<AuthResponse>('/api/auth/login', { email, password }),
    );
    this.persist(res);
  }

  async logout(): Promise<void> {
    const refreshToken = this.refreshTokenValue();
    this.accessToken.set(null);
    this.refreshTokenValue.set(null);
    this.user.set(null);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    if (refreshToken) {
      try {
        await firstValueFrom(this.http.post('/api/auth/logout', { refreshToken }));
      } catch {
        /* melhor esforço */
      }
    }
    this.router.navigateByUrl('/login');
  }

  /** Limpa a sessão local (sem chamar a API) e manda o usuário para o login. */
  private clearSessionAndRedirect(): void {
    this.accessToken.set(null);
    this.refreshTokenValue.set(null);
    this.user.set(null);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    this.router.navigateByUrl('/login');
  }

  /** Troca o refresh token atual por um novo par; deduplicado entre chamadas concorrentes. */
  async refreshAccessToken(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    // Relê do localStorage (não só o signal em memória): outra aba pode já ter
    // rotacionado o refresh token, e usar o antigo aciona a detecção de reuso
    // no backend, derrubando a sessão de todas as abas.
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken && refreshToken !== this.refreshTokenValue()) {
      this.refreshTokenValue.set(refreshToken);
    }
    if (!refreshToken) {
      // Sem token de acesso nem refresh: a sessão nunca existiu ou foi perdida
      // (ex.: storage limpo). Mandar para o login em vez de falhar em silêncio.
      this.clearSessionAndRedirect();
      return null;
    }

    this.refreshInFlight = (async () => {
      try {
        const res = await firstValueFrom(
          this.http.post<AuthResponse>('/api/auth/refresh', { refreshToken }),
        );
        this.persist(res);
        return res.accessToken;
      } catch {
        this.clearSessionAndRedirect();
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }
}
