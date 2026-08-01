import * as THREE from 'three';

const MAX_DPR = 3;

const measure = (font, text) => {
    const g = document.createElement('canvas').getContext('2d');
    g.font = font;

    return Math.ceil(g.measureText(text).width);
};

/**
 * A name drawn into a canvas sized to the text itself: a fixed canvas stretched to a
 * fixed sprite is what makes these blurry, since a short name is scaled up the most.
 * Mipmaps are off for the same reason, and the sprite keeps the canvas aspect.
 */
export function labelMaterial(name, color = '#dddddd', {
    fontPx = 28, weight = 600, opacity = 1, depthTest = true,
} = {}) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const font = `${weight} ${fontPx}px system-ui, sans-serif`;
    const pad = Math.ceil(fontPx * 0.45);
    const w = measure(font, name || ' ') + pad * 2;
    const h = Math.ceil(fontPx * 1.5);

    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));

    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(3, fontPx * 0.22);
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(name, w / 2, h / 2);
    g.fillStyle = color;
    g.fillText(name, w / 2, h / 2);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    return {
        material: new THREE.SpriteMaterial({
            map: tex, transparent: true, opacity, depthTest, depthWrite: false,
        }),
        aspect: w / h,
    };
}

export function makeLabel(name, color, options = {}) {
    const { worldHeight = 1.3 } = options;
    const { material, aspect } = labelMaterial(name, color, options);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(worldHeight * aspect, worldHeight, 1);

    return sprite;
}

export const peerLabel = (name, color) => makeLabel(name, color, {
    fontPx: 26, weight: 500, worldHeight: 1.1, opacity: 0.9,
});
