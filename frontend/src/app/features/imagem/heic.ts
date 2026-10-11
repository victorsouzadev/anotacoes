/** Fotos de iPhone (HEIC): detectar e converter pra JPEG. Serve o modo
 * Redes sociais e o painel de post com IA. */

/** Foto de iPhone. O `type` vem vazio em vários sistemas (o navegador não
 * conhece o formato), então a extensão também conta. */
export function isHeicFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence') return true;
  return /\.hei[cf]$/i.test(file.name);
}

/** Converte HEIC em JPEG. O decodificador (libheif em WebAssembly) é pesado e
 * nenhum navegador fora do Safari abre HEIC sozinho, então ele entra por import
 * dinâmico: só baixa quando alguém realmente solta uma foto de iPhone. */
export async function heicToJpeg(file: File): Promise<Blob> {
  const { heicTo } = await import('heic-to');
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}

/** HEIC vira um File JPEG com o mesmo nome (.jpg); o resto passa direto. */
export async function asBrowserImage(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  const jpeg = await heicToJpeg(file);
  return new File([jpeg], file.name.replace(/\.hei[cf]$/i, '') + '.jpg', { type: 'image/jpeg' });
}
