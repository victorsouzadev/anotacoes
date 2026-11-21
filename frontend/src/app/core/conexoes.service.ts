import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const BASE = '/api/core';

/** Aplicativo autorizado pelo OAuth do núcleo (spec 030) a usar o MCP de um plug-in. */
export interface AppAutorizado {
  id: string;
  nome: string;
  plugin: string;
  criado_em: string;
  ultimo_uso: string | null;
}

export interface PedidoOAuth {
  cliente: string;
  plugin: string;
  plugin_nome: string;
  redirect_host: string;
}

/** Token MCP estático de um plug-in. O valor só vem na criação. */
export interface TokenMcp {
  id: string;
  plugin: string;
  criadoEm: string;
  ultimoUso: string | null;
}

@Injectable({ providedIn: 'root' })
export class ConexoesService {
  private readonly http = inject(HttpClient);

  pedido(id: string): Promise<PedidoOAuth> {
    return firstValueFrom(this.http.get<PedidoOAuth>(`${BASE}/oauth/pedido/${encodeURIComponent(id)}`));
  }

  consentir(pedido: string, aprovar: boolean): Promise<{ redirect: string }> {
    return firstValueFrom(this.http.post<{ redirect: string }>(`${BASE}/oauth/consentir`, { pedido, aprovar }));
  }

  autorizados(): Promise<AppAutorizado[]> {
    return firstValueFrom(this.http.get<AppAutorizado[]>(`${BASE}/oauth/clientes`));
  }

  revogarApp(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${BASE}/oauth/clientes/${encodeURIComponent(id)}`));
  }

  tokens(): Promise<TokenMcp[]> {
    return firstValueFrom(this.http.get<TokenMcp[]>(`${BASE}/mcp-tokens`));
  }

  criarToken(plugin: string): Promise<{ id: string; plugin: string; token: string }> {
    return firstValueFrom(this.http.post<{ id: string; plugin: string; token: string }>(`${BASE}/mcp-tokens`, { plugin }));
  }

  revogarToken(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${BASE}/mcp-tokens/${encodeURIComponent(id)}`));
  }
}
