export type ProvedorIa = '' | 'openrouter' | 'anthropic' | 'heuristico';

export interface ModeloSugerido {
  id: string;
  nome: string;
  descricao: string;
  /** Decide se importar foto de cupom e PDF vai funcionar. */
  leImagens: boolean;
}

export interface ConfiguracaoIa {
  /** O que o usuário escolheu; vazio = seguir o padrão do servidor. */
  provedor: ProvedorIa;
  modelo: string | null;

  /** O que de fato será usado, já combinado com o padrão do servidor. */
  provedorEfetivo: string;
  modeloEfetivo: string;
  suportaAnexos: boolean;

  chaveConfigurada: boolean;
  /** Algo como "••••••••a1b2". A chave inteira nunca chega ao cliente. */
  chaveMascarada: string | null;
  usandoChaveDoServidor: boolean;

  modelosSugeridos: ModeloSugerido[];
  atualizadoEm: string | null;
}

export interface SalvarConfiguracaoIaRequest {
  provedor: ProvedorIa;
  modelo: string | null;
  /** `null` mantém a chave salva; string vazia remove; texto substitui. */
  chaveApi: string | null;
}

export interface TesteConexao {
  ok: boolean;
  mensagem: string;
  exemplo: string | null;
}

export const PROVEDORES: { valor: ProvedorIa; rotulo: string; descricao: string }[] = [
  {
    valor: '',
    rotulo: 'Padrão do servidor',
    descricao: 'Usa a chave configurada no servidor, se houver.',
  },
  {
    valor: 'openrouter',
    rotulo: 'OpenRouter',
    descricao: 'Acesso a modelos de vários fornecedores com uma chave só. Único que lê cupom e PDF.',
  },
  {
    valor: 'anthropic',
    rotulo: 'Anthropic (direto)',
    descricao: 'Chama a API da Anthropic sem intermediário. Interpreta apenas texto.',
  },
  {
    valor: 'heuristico',
    rotulo: 'Sem IA (local)',
    descricao: 'Interpreta o texto por regras, sem custo e sem enviar nada para fora.',
  },
];
