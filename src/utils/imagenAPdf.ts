import { PDFDocument } from 'pdf-lib';

// Convierte una o varias fotos en un PDF de una página por foto, con la página
// del tamaño exacto de la imagen (no se escala ni se recorta nada).
// pdf-lib solo entiende JPEG y PNG; Telegram manda las fotos como JPEG.
export async function fotosAPdf(fotos: Array<{ buffer: Buffer; mimeType: string }>): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const foto of fotos) {
    const img = foto.mimeType === 'image/png'
      ? await pdf.embedPng(foto.buffer)
      : await pdf.embedJpg(foto.buffer);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return Buffer.from(await pdf.save());
}
