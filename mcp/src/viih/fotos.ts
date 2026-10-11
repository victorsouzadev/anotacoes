// Fotos chegam como caminho no computador ou link: o LLM não consegue repassar
// os bytes de um anexo da conversa. Aqui elas são lidas e reduzidas — uma
// versão pequena pra IA olhar, uma maior pro editor montar o post.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import convertHeic from 'heic-convert';
import sharp from 'sharp';

export interface Foto {
  nome: string;
  bytes: Buffer;
}

const EXTENSOES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif', '.gif', '.tif', '.tiff']);
const MAX_BYTES = 40 * 1024 * 1024;

export function expandirCaminho(ref: string): string {
  const r = ref.trim();
  if (r === '~' || r.startsWith('~/')) return resolve(homedir(), r.slice(2));
  return resolve(r);
}

export async function lerFoto(ref: string): Promise<Foto> {
  const r = ref.trim();
  if (/^https?:\/\//i.test(r)) {
    const res = await fetch(r);
    if (!res.ok) throw new Error(`Não consegui baixar ${r} (HTTP ${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error(`${r} passa de 40 MB.`);
    return { nome: basename(new URL(r).pathname) || 'foto.jpg', bytes };
  }
  const caminho = expandirCaminho(r);
  if (!EXTENSOES.has(extname(caminho).toLowerCase())) throw new Error(`${caminho} não parece uma foto (jpg, png, webp, heic…).`);
  const bytes = await readFile(caminho).catch(() => {
    throw new Error(`Não achei o arquivo ${caminho}.`);
  });
  if (bytes.length > MAX_BYTES) throw new Error(`${caminho} passa de 40 MB.`);
  return { nome: basename(caminho), bytes };
}

export function ehHeic(nome: string): boolean {
  return /\.hei[cf]$/i.test(nome);
}

/** Bytes que o sharp abre: o sharp que vem do npm não decodifica o HEIC do
 * iPhone (só AVIF), então HEIC passa antes por um conversor em JS. */
async function decodificavel(foto: Foto): Promise<Buffer> {
  if (!ehHeic(foto.nome)) return foto.bytes;
  try {
    return Buffer.from(await convertHeic({ buffer: foto.bytes, format: 'JPEG', quality: 0.92 }));
  } catch {
    throw new Error(`Não consegui converter ${foto.nome} (HEIC). Exporte como JPEG e tente de novo.`);
  }
}

/** JPEG com o lado maior em `lado` px (sem ampliar), como data URL. Gira
 * conforme o EXIF, que é como o celular grava foto em pé. */
export async function reduzir(foto: Foto, lado: number, qualidade: number): Promise<string> {
  const bytes = await decodificavel(foto);
  try {
    const jpeg = await sharp(bytes).rotate()
      .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: qualidade, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    throw new Error(`Não consegui abrir ${foto.nome}. O arquivo pode estar corrompido ou num formato que não reconheço.`);
  }
}

/** Pro site: JPG, PNG e WebP vão como estão (o painel reduz); o resto — HEIC,
 * AVIF, TIFF — vira JPEG antes. */
export async function paraOSite(foto: Foto): Promise<Foto> {
  if (/\.(jpe?g|png|webp)$/i.test(foto.nome)) return foto;
  const url = await reduzir(foto, 2400, 88);
  return { nome: foto.nome.replace(/\.[^.]+$/, '') + '.jpg', bytes: Buffer.from(url.split(',')[1], 'base64') };
}
