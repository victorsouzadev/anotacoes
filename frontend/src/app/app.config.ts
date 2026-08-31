import { ApplicationConfig, DEFAULT_CURRENCY_CODE, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import ptBr from '@angular/common/locales/pt';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';

// Sem isso os pipes `currency`/`date`/`number` formatariam em inglês:
// "R$1234.56" em vez de "R$ 1.234,56".
registerLocaleData(ptBr, 'pt-BR');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'BRL' },
  ],
};
