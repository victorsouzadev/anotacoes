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
  apiUrl: (process.env.HUB_API_URL ?? 'http://191.252.177.244:8090').replace(/\/+$/, ''),
  email: required('HUB_EMAIL'),
  password: required('HUB_PASSWORD'),
};
