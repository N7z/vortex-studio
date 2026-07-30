const MAX = 128;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export async function decodeImage(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const { data } = ctx.getImageData(0, 0, w, h);
    const out = new Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        out[p] = HEX[data[i]] + HEX[data[i + 1]] + HEX[data[i + 2]] + HEX[data[i + 3]];
    }

    return {
        name: file.name,
        w,
        h,
        data: out.join(''),
        srcW: bmp.width || w,
        srcH: bmp.height || h,
        url: canvas.toDataURL(),
    };
}

export function imageMeta(img) {
    if (!img) return null;
    const { data, ...rest } = img;
    return rest;
}
