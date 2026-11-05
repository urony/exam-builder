// הכנת תמונה שהמורה מעלה: אימות סוג, הקטנה סבירה, המרה ל-PNG/JPEG (לשמירה קלה ולתאימות ל-Word).
const MAX_DIM = 1800;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function prepareImage(file) {
  if (!OK_TYPES.includes(file.type)) throw new Error('סוג קובץ לא נתמך (PNG, JPG, WEBP או GIF)');
  if (file.size > 15e6) throw new Error('הקובץ גדול מדי (מעל 15MB)');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const isPng = file.type === 'image/png';
  if (isPng && scale === 1 && file.size < 2e6) return { data: bytes, name: file.name };
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return { data: new Uint8Array(await blob.arrayBuffer()), name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}
