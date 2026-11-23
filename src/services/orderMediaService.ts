import {getById, STORES} from '../db/indexedDb';
import {MediaBlobRecord, Order, Product, StoreProfile} from '../types/commerce';
import {formatDateTime, formatMoney} from '../utils/format';
import {blobToDataUrl} from './mediaService';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function generateOrderVisualCardBlob(
  order: Order,
  products: Product[],
  storeProfile: StoreProfile,
): Promise<{blob: Blob; itemImageFiles: File[]}> {
  const itemEntries: Array<{
    name: string;
    qty: number;
    lineTotal: number;
    img: HTMLImageElement | null;
    file: File | null;
  }> = [];

  for (const item of order.items) {
    const prod = products.find((p) => p.id === item.productId);
    let img: HTMLImageElement | null = null;
    let file: File | null = null;
    if (prod?.imageBlobId) {
      const rec = await getById<MediaBlobRecord>(STORES.MEDIA_BLOBS, prod.imageBlobId);
      if (rec?.blob) {
        const dataUrl = await blobToDataUrl(rec.blob);
        img = await loadImage(dataUrl);
        file = new File([rec.blob], `${prod.sku || prod.id}.jpg`, {
          type: rec.mimeType || 'image/jpeg',
        });
      }
    }
    itemEntries.push({
      name: item.productName,
      qty: item.quantity,
      lineTotal: item.lineTotal,
      img,
      file,
    });
  }

  const width = 820;
  const rowHeight = 104;
  const headerH = 136;
  const footerH = 110;
  const height = headerH + Math.max(1, itemEntries.length) * rowHeight + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas indisponible pour générer le visuel de commande.');
  }

  // Background
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);

  // Header
  const primary = storeProfile.primaryColor || '#0F172A';
  const accent = storeProfile.accentColor || '#059669';
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, width, headerH - 6);
  ctx.fillStyle = accent;
  ctx.fillRect(0, headerH - 6, width, 6);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(storeProfile.name || 'ZANDO Pro', 32, 48);
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(`Commande ${order.orderNumber} · ${order.channel}`, 32, 80);
  ctx.font = 'normal 15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillText(
    `Client : ${order.customerName}${order.customerPhone ? ` (${order.customerPhone})` : ''} · ${formatDateTime(order.createdAt)}`,
    32,
    108,
  );

  // Items with photos
  let y = headerH + 18;
  for (const entry of itemEntries) {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(28, y, width - 56, rowHeight - 14, 14);
    ctx.fill();
    ctx.stroke();

    if (entry.img) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(40, y + 10, 70, 70, 10);
      ctx.clip();
      ctx.drawImage(entry.img, 40, y + 10, 70, 70);
      ctx.restore();
    } else {
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.roundRect(40, y + 10, 70, 70, 10);
      ctx.fill();
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(entry.name.slice(0, 2).toUpperCase(), 75, y + 52);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(entry.name.slice(0, 38), 128, y + 38);

    ctx.fillStyle = '#475569';
    ctx.font = 'normal 16px sans-serif';
    ctx.fillText(`Quantité : ${entry.qty}`, 128, y + 66);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatMoney(entry.lineTotal, storeProfile.currency), width - 48, y + 52);
    ctx.textAlign = 'left';

    y += rowHeight;
  }

  // Footer Total
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('Total commande :', 32, height - 52);
  ctx.fillStyle = accent;
  ctx.textAlign = 'right';
  ctx.fillText(formatMoney(order.total, storeProfile.currency), width - 32, height - 52);
  ctx.textAlign = 'left';

  if (order.deliveryAddress) {
    ctx.fillStyle = '#475569';
    ctx.font = 'normal 14px sans-serif';
    ctx.fillText(`Livraison : ${order.deliveryAddress}`, 32, height - 22);
  }

  const cardBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Échec génération image commande.'))),
      'image/jpeg',
      0.9,
    );
  });

  return {
    blob: cardBlob,
    itemImageFiles: itemEntries.map((e) => e.file).filter((f): f is File => f !== null),
  };
}
