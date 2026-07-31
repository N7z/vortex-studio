const MAX = 2048;
const THUMB = 192;

const store = new Map();
let seq = 0;

export async function decodeImage(file) {
    const bmp = await createImageBitmap(file);
    const srcW = bmp.width;
    const srcH = bmp.height;
    const scale = Math.min(1, MAX / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);

    const tScale = Math.min(1, THUMB / Math.max(w, h));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(w * tScale));
    thumb.height = Math.max(1, Math.round(h * tScale));
    const tctx = thumb.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    bmp.close?.();

    const id = `img-${++seq}`;
    store.set(id, { w, h, data, bounds: new Map() });

    return {
        id,
        name: file.name,
        w,
        h,
        srcW,
        srcH,
        url: thumb.toDataURL(),
    };
}

export function imagePixels(id) {
    return (id && store.get(id)) ?? null;
}

export function imageMeta(img) {
    if (!img) return null;
    const { data, ...rest } = img;
    return rest;
}
