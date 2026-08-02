import * as THREE from 'three';

const SIZE = 320;
const FRAMES = 36;
const DELAY = 60;

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function flip(src) {
    const out = new Uint8ClampedArray(src.length);
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) {
        out.set(src.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
    }

    return out;
}

export async function recordTurntable({ renderer, scene, camera, holder }, onProgress) {
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc');

    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;

    const wasAspect = camera.aspect;
    const wasSpin = holder.rotation.y;
    const buffer = new Uint8Array(SIZE * SIZE * 4);
    const gif = GIFEncoder();

    try {
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        renderer.setRenderTarget(target);

        const shots = [];
        for (let i = 0; i < FRAMES; i++) {
            holder.rotation.y = wasSpin + (i / FRAMES) * Math.PI * 2;
            renderer.render(scene, camera);
            renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, buffer);
            shots.push(flip(buffer));
            onProgress?.(((i + 1) / FRAMES) * 0.6);
            await nextFrame();
        }

        const step = 5;
        const each = Math.floor((SIZE * SIZE) / step);
        const sample = new Uint8ClampedArray(shots.length * each * 4);
        shots.forEach((s, f) => {
            for (let i = 0; i < each; i++) {
                sample.set(s.subarray(i * step * 4, i * step * 4 + 4), (f * each + i) * 4);
            }
        });
        const bg = new THREE.Color(scene.background ?? 0x000000).getHex();
        const palette = [[(bg >> 16) & 255, (bg >> 8) & 255, bg & 255], ...quantize(sample, 255)];

        for (let i = 0; i < shots.length; i++) {
            gif.writeFrame(applyPalette(shots[i], palette), SIZE, SIZE, { palette, delay: DELAY });
            onProgress?.(0.6 + ((i + 1) / shots.length) * 0.4);
            if (i % 6 === 5) await nextFrame();
        }
        gif.finish();

        return new Blob([gif.bytesView()], { type: 'image/gif' });
    } finally {
        renderer.setRenderTarget(null);
        target.dispose();
        holder.rotation.y = wasSpin;
        camera.aspect = wasAspect;
        camera.updateProjectionMatrix();
    }
}
