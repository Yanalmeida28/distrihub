const uploadLimit = 2 * 1024 * 1024;
const extensions: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' };

async function openImage(photo: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(photo);
  try {
    const source = new Image();
    source.src = url;
    await source.decode();
    return source;
  } catch {
    throw new Error('Não foi possível abrir esta foto. Escolha outro arquivo de imagem.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function openHeicImage(photo: Blob): Promise<HTMLImageElement> {
  try {
    return await openImage(photo);
  } catch {
    let jpeg: Blob;
    try {
      const { heicTo } = await import('heic-to/csp');
      jpeg = await heicTo({ blob: photo, type: 'image/jpeg', quality: 0.85 });
    } catch {
      throw new Error('Não foi possível converter esta foto HEIC. Tente exportá-la como JPG e selecione novamente.');
    }
    return openImage(jpeg);
  }
}

export async function prepareProductPhoto(file: File): Promise<File> {
  if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Escolha uma foto de até 25 MB.');
  const extension = file.name?.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type.toLowerCase() || extensions[extension] || '';
  if (!Object.values(extensions).includes(type) && !['image/heic-sequence', 'image/heif-sequence'].includes(type)) {
    throw new Error('Escolha uma foto JPG, PNG, WebP, HEIC, HEIF, AVIF, GIF ou BMP.');
  }
  const photo = file.type ? file : new File([file], file.name, { type });
  if (['image/jpeg', 'image/png', 'image/webp'].includes(type) && photo.size <= uploadLimit) return photo;
  const image = type.startsWith('image/hei') ? await openHeicImage(photo) : await openImage(photo);

  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a foto neste navegador.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.5]) {
    const compressed = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (compressed?.size && compressed.size <= uploadLimit) return new File([compressed], 'foto-produto.jpg', { type: 'image/jpeg' });
  }
  throw new Error('Não foi possível reduzir a foto. Escolha uma imagem menor.');
}
