import { baixarBlob } from '../../shared/download';
import { Acompanhamento, Orcamento } from './models/orcamento.model';

/**
 * Monta o orçamento do mês como uma imagem PNG, para mandar no WhatsApp ou
 * guardar junto de outros documentos do mês.
 *
 * O arquivo é desenhado à mão num canvas em vez de fotografar o DOM: nada de
 * dependência nova, o resultado não muda quando o CSS da tela muda, e o cartão
 * sai sempre com a mesma largura — uma captura de tela do componente sairia com
 * o tamanho da janela de quem exportou.
 *
 * O módulo é dividido em duas metades de propósito: `montarCartao` é uma função
 * pura que decide o que aparece e onde, e por isso é testável sem canvas;
 * `desenharCartao` só pinta o que ela decidiu.
 */

// --------------------------------------------------------------- formatação

/**
 * Reais no formato brasileiro, sem depender de `toLocaleString`.
 *
 * O `Intl` do navegador insere um espaço não separável depois do "R$" e a
 * própria presença dos dados de locale varia por ambiente. Como o texto vai
 * virar pixels num arquivo que o usuário compartilha, a formatação precisa ser
 * a mesma em todo lugar.
 */
export function moedaBr(valor: number): string {
  const sinal = valor < 0 ? '-' : '';
  const [inteiro, centavos] = Math.abs(valor).toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${comMilhar},${centavos}`;
}

export function percentualBr(valor: number, casas = 0): string {
  return `${valor.toFixed(casas).replace('.', ',')}%`;
}

function dataBr(data: Date): string {
  const d = String(data.getDate()).padStart(2, '0');
  const m = String(data.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${data.getFullYear()}`;
}

// ------------------------------------------------------------ modelo visual

export type Tom = 'neutro' | 'positivo' | 'negativo' | 'atencao';

export interface MetricaCartao {
  rotulo: string;
  valor: string;
  tom: Tom;
}

export interface BarraCartao {
  /** Fração de 0 a 1 já limitada — acima de 100% a barra fica cheia e vermelha. */
  fracao: number;
  tom: Tom;
}

export interface CategoriaCartao {
  nome: string;
  /** "R$ 820,00 de R$ 1.000,00" — ou só o gasto, quando não há planejado. */
  valores: string;
  barra: BarraCartao | null;
  rodape: string;
  foraDoOrcamento: boolean;
}

export interface CartaoOrcamento {
  titulo: string;
  total: string;
  metricas: MetricaCartao[];
  barraGeral: BarraCartao;
  /** Posição da marca de ritmo, de 0 a 1; ausente fora do mês corrente. */
  marcaRitmo: number | null;
  legendaBarra: string;
  diagnostico: { texto: string; tom: Tom } | null;
  categorias: CategoriaCartao[];
  grupos: { nome: string; valores: string }[];
  observacoes: string[];
  rodape: string;
  largura: number;
  altura: number;
}

export interface DadosCartao {
  nomeDoMes: string;
  orcamento: Orcamento;
  acompanhamento: Acompanhamento;
  diagnostico: { tom: Tom; texto: string } | null;
  geradoEm: Date;
}

// Medidas em px. Ficam aqui porque `montarCartao` calcula a altura com elas e o
// desenho anda por elas — as duas metades precisam concordar.
export const LARGURA = 880;
const MARGEM = 40;
const RECUO_PAINEL = 16;
const ALTURA_CABECALHO = 132;
const ALTURA_METRICAS = 92;
const ALTURA_BARRA_GERAL = 64;
const ALTURA_DIAGNOSTICO = 40;
const ALTURA_TITULO_SECAO = 46;
const ALTURA_CATEGORIA = 66;
const ALTURA_CATEGORIA_SEM_BARRA = 40;
const ALTURA_GRUPOS = 56;
const ALTURA_LINHA_OBS = 24;
const ALTURA_RODAPE = 58;

function fracao(percentual: number): number {
  if (!Number.isFinite(percentual) || percentual <= 0) return 0;
  return Math.min(percentual, 100) / 100;
}

/** Quebra o texto em linhas que cabem na largura, por palavra. */
export function quebrarLinhas(
  texto: string,
  larguraMax: number,
  medir: (t: string) => number,
  maxLinhas = 3,
): string[] {
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [];

  const linhas: string[] = [];
  let atual = '';

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (atual && medir(tentativa) > larguraMax) {
      linhas.push(atual);
      atual = palavra;
      if (linhas.length === maxLinhas) break;
    } else {
      atual = tentativa;
    }
  }

  if (linhas.length < maxLinhas && atual) linhas.push(atual);

  // Sinaliza o corte em vez de deixar a frase terminar no meio sem aviso.
  if (linhas.length === maxLinhas && atual && linhas[maxLinhas - 1] !== atual) {
    linhas[maxLinhas - 1] = `${linhas[maxLinhas - 1]}…`;
  }

  return linhas;
}

/** Estimativa usada quando não há canvas para medir (testes). */
const MEDIDA_APROXIMADA = (t: string) => t.length * 7.2;

export function montarCartao(dados: DadosCartao, medir = MEDIDA_APROXIMADA): CartaoOrcamento {
  const a = dados.acompanhamento;

  const metricas: MetricaCartao[] = [
    { rotulo: 'Gasto', valor: moedaBr(a.totalRealizado), tom: 'neutro' },
    {
      rotulo: 'Disponível',
      valor: moedaBr(a.saldoDisponivel),
      tom: a.saldoDisponivel < 0 ? 'negativo' : 'positivo',
    },
    {
      rotulo: 'Projeção do mês',
      valor: moedaBr(a.projecaoFimDoMes),
      tom: a.projecaoFimDoMes > a.valorTotal ? 'negativo' : 'neutro',
    },
  ];

  const categorias: CategoriaCartao[] = a.itens.map((i) => {
    const temPlanejado = i.valorPlanejado > 0;
    const excedeu = i.valorRestante < 0;

    return {
      nome: i.categoriaRotulo,
      valores: temPlanejado
        ? `${moedaBr(i.valorRealizado)} de ${moedaBr(i.valorPlanejado)}`
        : moedaBr(i.valorRealizado),
      barra: temPlanejado
        ? {
            fracao: fracao(i.percentualUtilizado),
            tom: i.situacao === 'estourado' ? 'negativo' : i.situacao === 'atencao' ? 'atencao' : 'positivo',
          }
        : null,
      rodape: temPlanejado
        ? `${percentualBr(i.percentualUtilizado)} usado · ${percentualBr(i.percentual, 1)} do total · ` +
          `${excedeu ? 'excedeu' : 'restam'} ${moedaBr(Math.abs(i.valorRestante))}`
        : 'fora do orçamento',
      foraDoOrcamento: i.situacao === 'sem_orcamento',
    };
  });

  const observacoes = dados.orcamento.observacoes
    ? quebrarLinhas(dados.orcamento.observacoes, LARGURA - MARGEM * 2, medir)
    : [];

  const grupos = a.grupos.map((g) => ({
    nome: g.grupoRotulo,
    valores: `${moedaBr(g.valorRealizado)} / ${moedaBr(g.valorPlanejado)}`,
  }));

  const altura =
    ALTURA_CABECALHO +
    ALTURA_METRICAS +
    ALTURA_BARRA_GERAL +
    (dados.diagnostico ? ALTURA_DIAGNOSTICO : 0) +
    (categorias.length > 0 ? ALTURA_TITULO_SECAO : 0) +
    categorias.reduce((soma, c) => soma + (c.barra ? ALTURA_CATEGORIA : ALTURA_CATEGORIA_SEM_BARRA), 0) +
    (grupos.length > 0 ? ALTURA_GRUPOS : 0) +
    observacoes.length * ALTURA_LINHA_OBS +
    ALTURA_RODAPE;

  return {
    titulo: `Orçamento de ${dados.nomeDoMes}`,
    total: moedaBr(a.valorTotal),
    metricas,
    barraGeral: {
      fracao: fracao(a.percentualUtilizado),
      tom: a.percentualUtilizado > 100 ? 'negativo' : 'positivo',
    },
    marcaRitmo:
      a.percentualDoMesDecorrido > 0 && a.percentualDoMesDecorrido < 100
        ? a.percentualDoMesDecorrido / 100
        : null,
    legendaBarra: `${percentualBr(a.percentualUtilizado)} do orçamento`,
    diagnostico: dados.diagnostico,
    categorias,
    grupos,
    observacoes,
    rodape: `Gerado em ${dataBr(dados.geradoEm)} · Anotações`,
    largura: LARGURA,
    altura,
  };
}

export function nomeArquivoImagem(ano: number, mes: number): string {
  return `orcamento-${ano}-${String(mes).padStart(2, '0')}.png`;
}

// ------------------------------------------------------------------ desenho

export interface PaletaCartao {
  fundo: string;
  cartao: string;
  texto: string;
  suave: string;
  trilho: string;
  neutro: string;
  positivo: string;
  negativo: string;
  atencao: string;
}

/**
 * A imagem sai sempre clara, mesmo com o app no tema escuro: ela vai ser vista
 * fora daqui — num chat, impressa — onde fundo escuro costuma ficar ilegível.
 */
export const PALETA_CLARA: PaletaCartao = {
  fundo: '#f4f4f7',
  cartao: '#ffffff',
  texto: '#1c1c26',
  suave: '#71717f',
  trilho: '#e7e7ee',
  neutro: '#6d5ef8',
  positivo: '#16a34a',
  negativo: '#dc2626',
  atencao: '#d97706',
};

function corDoTom(tom: Tom, paleta: PaletaCartao): string {
  switch (tom) {
    case 'positivo': return paleta.positivo;
    case 'negativo': return paleta.negativo;
    case 'atencao': return paleta.atencao;
    default: return paleta.texto;
  }
}

function retanguloArredondado(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, largura: number, altura: number, raio: number,
): void {
  // roundRect é recente; sem ele a barra vira um retângulo reto, que é feio mas
  // não quebra a exportação.
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, largura, altura, raio);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, largura, altura);
  }
}

function barra(
  ctx: CanvasRenderingContext2D, x: number, y: number, largura: number, altura: number,
  b: BarraCartao, paleta: PaletaCartao,
): void {
  ctx.fillStyle = paleta.trilho;
  retanguloArredondado(ctx, x, y, largura, altura, altura / 2);

  if (b.fracao > 0) {
    ctx.fillStyle = corDoTom(b.tom, paleta);
    // Largura mínima para que uma fatia quase zerada ainda apareça.
    retanguloArredondado(ctx, x, y, Math.max(largura * b.fracao, altura), altura, altura / 2);
  }
}

export function desenharCartao(
  ctx: CanvasRenderingContext2D,
  cartao: CartaoOrcamento,
  paleta: PaletaCartao = PALETA_CLARA,
): void {
  const larguraUtil = cartao.largura - MARGEM * 2;
  const direita = cartao.largura - MARGEM;

  ctx.fillStyle = paleta.fundo;
  ctx.fillRect(0, 0, cartao.largura, cartao.altura);

  // Painel branco sobre o fundo: dá borda à imagem, para ela não se confundir
  // com o fundo do aplicativo em que for colada.
  ctx.fillStyle = paleta.cartao;
  retanguloArredondado(ctx, RECUO_PAINEL, RECUO_PAINEL,
    cartao.largura - RECUO_PAINEL * 2, cartao.altura - RECUO_PAINEL * 2, 20);

  ctx.textBaseline = 'alphabetic';

  let y = 0;

  // ------------------------------------------------------------- cabeçalho
  y += 56;
  ctx.fillStyle = paleta.suave;
  ctx.font = '500 17px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(cartao.titulo, MARGEM, y);

  y += 50;
  ctx.fillStyle = paleta.texto;
  ctx.font = '700 42px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(cartao.total, MARGEM, y);

  y = ALTURA_CABECALHO;

  // -------------------------------------------------------------- métricas
  const larguraMetrica = larguraUtil / cartao.metricas.length;
  cartao.metricas.forEach((m, i) => {
    const x = MARGEM + larguraMetrica * i;
    ctx.textAlign = 'left';
    ctx.fillStyle = paleta.suave;
    ctx.font = '500 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(m.rotulo, x, y + 22);
    ctx.fillStyle = corDoTom(m.tom, paleta);
    ctx.font = '600 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(m.valor, x, y + 54);
  });
  y += ALTURA_METRICAS;

  // ----------------------------------------------------------- barra geral
  barra(ctx, MARGEM, y, larguraUtil, 14, cartao.barraGeral, paleta);

  if (cartao.marcaRitmo !== null) {
    // Onde o gasto estaria se fosse uniforme ao longo do mês.
    ctx.fillStyle = paleta.texto;
    ctx.fillRect(MARGEM + larguraUtil * cartao.marcaRitmo - 1, y - 4, 2, 22);
  }

  ctx.fillStyle = paleta.suave;
  ctx.font = '500 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(cartao.legendaBarra, direita, y + 40);
  ctx.textAlign = 'left';
  y += ALTURA_BARRA_GERAL;

  // ----------------------------------------------------------- diagnóstico
  if (cartao.diagnostico) {
    ctx.fillStyle = corDoTom(cartao.diagnostico.tom, paleta);
    ctx.font = '500 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(cartao.diagnostico.texto, MARGEM, y + 18);
    y += ALTURA_DIAGNOSTICO;
  }

  // ------------------------------------------------------------ categorias
  // Sem categorias o título ficaria sozinho, anunciando uma lista vazia.
  if (cartao.categorias.length > 0) {
    ctx.fillStyle = paleta.texto;
    ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Por categoria', MARGEM, y + 28);
    y += ALTURA_TITULO_SECAO;
  }

  cartao.categorias.forEach((c, indice) => {
    if (indice > 0) {
      ctx.fillStyle = paleta.trilho;
      ctx.fillRect(MARGEM, y - 10, larguraUtil, 1);
    }

    ctx.font = '500 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = c.foraDoOrcamento ? paleta.suave : paleta.texto;
    ctx.textAlign = 'left';
    ctx.fillText(c.nome, MARGEM, y + 16);

    ctx.font = '600 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = c.barra?.tom === 'negativo' ? paleta.negativo : paleta.texto;
    ctx.textAlign = 'right';
    ctx.fillText(c.valores, direita, y + 16);

    if (c.barra) {
      barra(ctx, MARGEM, y + 26, larguraUtil, 8, c.barra, paleta);
      ctx.textAlign = 'left';
      ctx.fillStyle = paleta.suave;
      ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(c.rodape, MARGEM, y + 52);
      y += ALTURA_CATEGORIA;
    } else {
      ctx.textAlign = 'left';
      ctx.fillStyle = paleta.suave;
      ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(c.rodape, MARGEM, y + 34);
      y += ALTURA_CATEGORIA_SEM_BARRA;
    }
  });

  // ---------------------------------------------------------------- grupos
  if (cartao.grupos.length > 0) {
    ctx.fillStyle = paleta.trilho;
    ctx.fillRect(MARGEM, y - 6, larguraUtil, 1);

    const larguraGrupo = larguraUtil / cartao.grupos.length;
    cartao.grupos.forEach((g, i) => {
      const x = MARGEM + larguraGrupo * i;
      ctx.textAlign = 'left';
      ctx.fillStyle = paleta.suave;
      ctx.font = '500 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(g.nome, x, y + 20);
      ctx.fillStyle = paleta.texto;
      ctx.font = '500 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(g.valores, x, y + 42);
    });
    y += ALTURA_GRUPOS;
  }

  // ----------------------------------------------------------- observações
  ctx.textAlign = 'left';
  ctx.fillStyle = paleta.suave;
  ctx.font = 'italic 400 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  for (const linha of cartao.observacoes) {
    ctx.fillText(linha, MARGEM, y + 16);
    y += ALTURA_LINHA_OBS;
  }

  // ---------------------------------------------------------------- rodapé
  ctx.fillStyle = paleta.suave;
  ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(cartao.rodape, MARGEM, y + 32);
}

// ---------------------------------------------------------------- exportação

/**
 * Desenha o cartão e devolve o PNG. A escala de 2 é o que faz o texto não sair
 * borrado em tela de alta densidade e ao ampliar a imagem no celular.
 */
export async function gerarPng(dados: DadosCartao, escala = 2): Promise<Blob> {
  const medidor = document.createElement('canvas').getContext('2d');
  const cartao = montarCartao(
    dados,
    medidor
      ? (t) => {
          medidor.font = 'italic 400 14px system-ui, sans-serif';
          return medidor.measureText(t).width;
        }
      : undefined,
  );

  const canvas = document.createElement('canvas');
  canvas.width = cartao.largura * escala;
  canvas.height = cartao.altura * escala;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador não permitiu desenhar a imagem.');

  ctx.scale(escala, escala);
  desenharCartao(ctx, cartao);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.'))),
      'image/png',
    );
  });
}

export async function exportarOrcamentoPng(dados: DadosCartao): Promise<void> {
  const blob = await gerarPng(dados);
  baixarBlob(nomeArquivoImagem(dados.acompanhamento.ano, dados.acompanhamento.mes), blob);
}
