import * as THREE from 'three';

const SIZE = 400;
const WIDTH = SIZE;
const HEIGHT = SIZE;
const QUALITY = 0.72;

// Fixed corner, so every map is framed the same way and is recognisable by shape.
const DIR = new THREE.Vector3(1, 0.85, 1).normalize();

/**
 * Renders the scene into an offscreen target rather than reading the live canvas:
 * capturing that one would need preserveDrawingBuffer, which costs every frame for
 * something taken once in a while.
 */
export function captureThumb(renderer, scene, parts) {
    if (!renderer || !scene || !parts?.length) return Promise.resolve(null);

    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const p of parts) {
        const [x, y, z] = p.P ?? [0, 0, 0];
        const [sx, sy, sz] = p.S ?? [1, 1, 1];
        bounds.expandByPoint(point.set(x - sx / 2, y - sy / 2, z - sz / 2));
        bounds.expandByPoint(point.set(x + sx / 2, y + sy / 2, z + sz / 2));
    }
    if (bounds.isEmpty()) return Promise.resolve(null);

    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);

    const camera = new THREE.PerspectiveCamera(35, WIDTH / HEIGHT, 0.1, radius * 40);
    // fov/2 in radians, with a margin so nothing touches the edges.
    const distance = (radius / Math.tan((35 * Math.PI) / 360)) * 1.25;
    camera.position.copy(centre).addScaledVector(DIR, distance);
    camera.lookAt(centre);

    const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
        colorSpace: THREE.SRGBColorSpace,
        samples: 4,
    });

    const previous = renderer.getRenderTarget();
    let pixels;
    try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        pixels = new Uint8Array(WIDTH * HEIGHT * 4);
        renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
    } finally {
        renderer.setRenderTarget(previous);
        target.dispose();
    }

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(WIDTH, HEIGHT);
    // WebGL reads bottom-up, a canvas is top-down.
    for (let y = 0; y < HEIGHT; y++) {
        const from = (HEIGHT - 1 - y) * WIDTH * 4;
        image.data.set(pixels.subarray(from, from + WIDTH * 4), y * WIDTH * 4);
    }
    ctx.putImageData(image, 0, 0);

    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/webp', QUALITY);
    });
}
