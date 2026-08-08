import * as THREE from 'three';

// The marks drawn on a part's faces. They are drawn rather than loaded so they stay
// crisp at any size, which matters twice over: the viewport wants one small tile per
// stud, and compositing one into a scanned material wants it at the material's own
// resolution. Upscaling a 64px tile into a 512px albedo would blur the studs.

// The coordinate system every mark below is drawn in; the context is scaled from it.
const UNIT = 64;

const MARKS = {
    stud: (g) => {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath();
        g.arc(33, 35, 15, 0, Math.PI * 2);
        g.fill();
        const grad = g.createLinearGradient(0, 17, 0, 47);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#c9c9c9');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(32, 32, 14, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.15)';
        g.lineWidth = 1.5;
        g.stroke();
    },
    inlet: (g) => {
        g.strokeStyle = 'rgba(0,0,0,0.13)';
        g.lineWidth = 6;
        g.beginPath();
        g.arc(32, 32, 13, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(32, 32, 16, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.10)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(32, 32, 10, 0, Math.PI * 2);
        g.stroke();
    },
    spawn: (g) => {
        g.strokeStyle = 'rgba(0,0,0,0.32)';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(32, 32, 22, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.beginPath();
        g.moveTo(32, 14);
        g.lineTo(46, 40);
        g.lineTo(32, 33);
        g.lineTo(18, 40);
        g.closePath();
        g.fill();
    },
    shirt: (g) => {
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath();
        g.moveTo(21, 13);
        g.lineTo(26, 13);
        g.lineTo(32, 19);
        g.lineTo(38, 13);
        g.lineTo(43, 13);
        g.lineTo(53, 24);
        g.lineTo(45, 32);
        g.lineTo(45, 52);
        g.lineTo(19, 52);
        g.lineTo(19, 32);
        g.lineTo(11, 24);
        g.closePath();
        g.fill();
    },
};

export const MARK_KINDS = Object.keys(MARKS);

/** One mark on white, at whatever resolution the caller needs. */
export function drawMark(kind, size = UNIT) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.scale(size / UNIT, size / UNIT);
    MARKS[kind]?.(g);

    return canvas;
}

export function makeMarkTexture(kind, size = UNIT) {
    const tex = new THREE.CanvasTexture(drawMark(kind, size));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    return tex;
}
