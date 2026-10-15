function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não definida. Configure-a no cliente MCP (ex.: claude_desktop_config.json).`,
    );
  }
  return value;
}

export const config = {
  apiUrl: (process.env.HUB_API_URL ?? 'https://cerebro.vsitefy.com.br').replace(/\/+$/, ''),
  /** Onde o app web abre (link do rascunho no editor). Padrão: o mesmo host da API. */
  webUrl: (process.env.HUB_WEB_URL ?? process.env.HUB_API_URL ?? 'https://cerebro.vsitefy.com.br').replace(/\/+$/, ''),
  email: required('HUB_EMAIL'),
  password: required('HUB_PASSWORD'),
};
