import { zip, Zippable } from 'fflate';

/** Um arquivo escolhido pelo usuário, com o caminho relativo à pasta enviada. */
export interface ArquivoDoPacote {
  caminho: string;
  arquivo: File;
}

/** Arquivos que o sistema operacional espalha e que não devem ir para o servidor. */
const IGNORADOS = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/i;

/**
 * Compacta a pasta escolhida num ZIP, no navegador. O servidor aceita uma pasta só por
 * fora (meu-app/api/..., meu-app/web/...), então o caminho relativo vai como veio.
 */
export async function compactar(arquivos: ArquivoDoPacote[]): Promise<Blob> {
  const entradas: Zippable = {};
  for (const { caminho, arquivo } of arquivos) {
    if (IGNORADOS.test(caminho)) continue;
    const dados = new Uint8Array(await arquivo.arrayBuffer());
    // DLL e imagem já vêm compactadas: nível baixo poupa CPU sem perder quase nada.
    entradas[caminho] = [dados, { level: /\.(png|jpe?g|gif|webp|woff2?|zip|gz|br)$/i.test(caminho) ? 0 : 6 }];
  }
  if (Object.keys(entradas).length === 0) throw new Error('A pasta está vazia.');
  return new Promise((resolve, reject) =>
    zip(entradas, (erro, bytes) =>
      erro ? reject(erro) : resolve(new Blob([bytes as BlobPart], { type: 'application/zip' })),
    ),
  );
}

/** Arquivos de um <input webkitdirectory>. */
export function daSelecaoDePasta(lista: FileList): ArquivoDoPacote[] {
  return Array.from(lista).map((arquivo) => ({
    caminho: (arquivo as File & { webkitRelativePath?: string }).webkitRelativePath || arquivo.name,
    arquivo,
  }));
}

/**
 * O que foi solto na área de envio: um .zip (vai direto) ou pastas/arquivos soltos
 * (lidos recursivamente pela API de entradas do navegador para compactar depois).
 */
export async function doArrastar(dados: DataTransfer): Promise<{ zip: File } | { arquivos: ArquivoDoPacote[] }> {
  const itens = Array.from(dados.items).filter((i) => i.kind === 'file');
  const entradas = itens.map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => e !== null);

  if (entradas.length === 1 && entradas[0].isFile) {
    const arquivo = dados.files[0];
    if (/\.zip$/i.test(arquivo.name)) return { zip: arquivo };
  }

  const arquivos: ArquivoDoPacote[] = [];
  for (const entrada of entradas) await lerEntrada(entrada, '', arquivos);
  return { arquivos };
}

async function lerEntrada(entrada: FileSystemEntry, prefixo: string, saida: ArquivoDoPacote[]): Promise<void> {
  const caminho = prefixo + entrada.name;
  if (entrada.isFile) {
    const arquivo = await new Promise<File>((ok, erro) => (entrada as FileSystemFileEntry).file(ok, erro));
    saida.push({ caminho, arquivo });
    return;
  }
  const leitor = (entrada as FileSystemDirectoryEntry).createReader();
  // readEntries devolve em lotes (100 no Chrome): lê até vir vazio.
  for (;;) {
    const lote = await new Promise<FileSystemEntry[]>((ok, erro) => leitor.readEntries(ok, erro));
    if (lote.length === 0) break;
    for (const filho of lote) await lerEntrada(filho, caminho + '/', saida);
  }
}

/** Sugestão de endereço a partir do nome: "Meu App de Recados" → "meu-app-de-recados". */
export function slugDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
