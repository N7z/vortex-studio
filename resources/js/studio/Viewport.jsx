import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
    PLACEHOLDER, makeMaterialSets, makePartGeometry, makeTrussGeometry, partType,
} from './parts3d';

const TOOL_MODE = { move: 'translate', rotate: 'rotate', scale: 'scale' };
const DEG = Math.PI / 180;
const IDENTITY_Q = new THREE.Quaternion();

const round = (v) => Math.round(v * 100) / 100;

function makeFaceTexture(draw) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    draw(g);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function makeStudTexture() {
    return makeFaceTexture((g) => {
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
    });
}

function makeInletTexture() {
    return makeFaceTexture((g) => {
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
    });
}

function makeSpawnTexture() {
    return makeFaceTexture((g) => {
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
    });
}

function makeShirtTexture() {
    return makeFaceTexture((g) => {
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
    });
}

const MIN_BATCH = 16;

const FACE_DIRS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const faceKey = (n) => `${n[0]},${n[1]},${n[2]}`;

const FACE_MATS = (() => {
    const out = new Map();
    const from = new THREE.Vector3(0, 0, 1);
    for (const d of FACE_DIRS) {
        const n = new THREE.Vector3(d[0], d[1], d[2]);
        const q = new THREE.Quaternion().setFromUnitVectors(from, n);
        const m = new THREE.Matrix4().compose(
            n.clone().multiplyScalar(0.503),
            q,
            new THREE.Vector3(0.98, 0.98, 1),
        );
        out.set(faceKey(d), m);
    }
    return out;
})();

function snapNormal(n) {
    if (!n) return null;
    const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    let k = 0;
    if (a[1] > a[k]) k = 1;
    if (a[2] > a[k]) k = 2;
    const sign = [n.x, n.y, n.z][k] < 0 ? -1 : 1;
    const out = [0, 0, 0];
    out[k] = sign;
    return out;
}

const MAX_OUTLINES = 192;
const MAX_PREVIEWS = 256;

const readTransform = (m) => ({
    P: [round(m.position.x), round(m.position.y), round(m.position.z)],
    R: [round(m.rotation.x / DEG), round(m.rotation.y / DEG), round(m.rotation.z / DEG)],
    S: [
        Math.max(round(m.scale.x), 0.05),
        Math.max(round(m.scale.y), 0.05),
        Math.max(round(m.scale.z), 0.05),
    ],
});

export default function Viewport({
    parts, selectedIds, setSelectedId, selectMany, tool, snap, onTransform, onTransformMany,
    mapName, graphics, preview, spawnRef, busyRef, canEdit = true, peers, onView,
    faces, showFaces = false, statsRef,
    playing = false, onExitPlay, touchRef,
}) {
    const mountRef = useRef(null);
    const ctx = useRef(null);
    const partsRef = useRef(parts);
    partsRef.current = parts;
    const gfxRef = useRef(graphics);
    gfxRef.current = graphics;
    const studs = graphics.studs;
    const mode = graphics.mode ?? 'lit';

    useEffect(() => {
        const mount = mountRef.current;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x7ec8e8);

        const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 5000);
        camera.position.set(40, 40, 40);

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            logarithmicDepthBuffer: true,
        });
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a5a52, 0.9));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(80, 160, 60);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const cam = sun.shadow.camera;
        cam.left = cam.bottom = -250;
        cam.right = cam.top = 250;
        cam.far = 800;
        scene.add(sun);

        const grid = new THREE.GridHelper(400, 100, 0x999999, 0xb5b5b5);
        grid.position.y = -0.01;
        scene.add(grid);

        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.mouseButtons = {
            LEFT: null,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: null,
        };
        orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
        orbit.target.set(0, 0, 0);

        const gizmo = new TransformControls(camera, renderer.domElement);
        if (window.matchMedia?.('(pointer: coarse)').matches) gizmo.size = 1.6;
        scene.add(gizmo.getHelper());

        // One outline per selected part, created on demand and reused. Every part is a
        // unit cube scaled by its size, so an outline is that cube's edges wearing the
        // part's world matrix, which keeps it tight around rotated parts, unlike an
        // axis-aligned Box3Helper.
        const selEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
        const selMat = new THREE.LineBasicMaterial({
            color: 0x2f7fd9, depthTest: false, depthWrite: false,
        });
        const bulkMin = new THREE.Vector3();
        const bulkMax = new THREE.Vector3();
        const bulkPos = new THREE.Vector3();
        const bulkSize = new THREE.Vector3();
        const selBoxes = [];
        const selBox = () => {
            const b = new THREE.LineSegments(selEdges, selMat);
            b.matrixAutoUpdate = false;
            b.renderOrder = 999;
            scene.add(b);
            selBoxes.push(b);
            return b;
        };

        // The same outline in someone else's colour: one material per colour, reused,
        // and a pool of boxes whose material is reassigned each frame.
        const peerMats = new Map();
        const peerMat = (color) => {
            let m = peerMats.get(color);
            if (!m) {
                m = new THREE.LineBasicMaterial({
                    color: new THREE.Color(color), depthTest: false, depthWrite: false,
                });
                peerMats.set(color, m);
            }
            return m;
        };
        // Where each peer is looking from: a cone at their camera, pointing the way they
        // face, with their name over it. Drawn without depth testing so a collaborator
        // behind a wall is still findable, which is the whole point of the marker.
        const markGeom = new THREE.ConeGeometry(0.5, 1.6, 12);
        markGeom.rotateX(Math.PI / 2);
        const markMats = new Map();
        const markMat = (color) => {
            let m = markMats.get(color);
            if (!m) {
                m = new THREE.MeshBasicMaterial({
                    color: new THREE.Color(color), depthTest: false, depthWrite: false,
                });
                markMats.set(color, m);
            }
            return m;
        };

        const labelMats = new Map();
        const labelMat = (name, color) => {
            const key = `${name}|${color}`;
            let m = labelMats.get(key);
            if (m) return m;
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 64;
            const g = c.getContext('2d');
            g.font = 'bold 30px system-ui, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillStyle = 'rgba(0,0,0,0.55)';
            g.fillRect(0, 12, 256, 40);
            g.fillStyle = color;
            g.fillText(name, 128, 32);
            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            m = new THREE.SpriteMaterial({
                map: tex, depthTest: false, depthWrite: false, transparent: true,
            });
            labelMats.set(key, m);
            return m;
        };

        const marks = [];
        const markTarget = new THREE.Vector3();
        const mark = () => {
            const cone = new THREE.Mesh(markGeom, markMat('#888888'));
            cone.renderOrder = 997;
            const label = new THREE.Sprite(labelMat('', '#888888'));
            label.scale.set(8, 2, 1);
            label.renderOrder = 1000;
            scene.add(cone);
            scene.add(label);
            const entry = { cone, label };
            marks.push(entry);
            return entry;
        };

        const faceGeom = new THREE.PlaneGeometry(1, 1);
        const faceMat = new THREE.MeshBasicMaterial({
            color: 0xff8c1a,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const faceQuads = [];
        const faceLocal = new THREE.Matrix4();
        const faceQuad = () => {
            const q = new THREE.Mesh(faceGeom, faceMat);
            q.matrixAutoUpdate = false;
            q.renderOrder = 996;
            scene.add(q);
            faceQuads.push(q);
            return q;
        };

        const peerBoxes = [];
        const peerBox = () => {
            const b = new THREE.LineSegments(selEdges, selMat);
            b.matrixAutoUpdate = false;
            b.renderOrder = 998;
            scene.add(b);
            peerBoxes.push(b);
            return b;
        };

        const batches = new Map();

        const dropBatch = (inst) => {
            scene.remove(inst);
            inst.dispose();
        };

        const syncBatches = () => {
            const c = ctx.current;
            if (!c) return;
            const members = new Map();
            for (const mesh of c.meshList) {
                const set = mesh.userData.set;
                const key = set && !set.transparent ? set.key : null;
                mesh.userData.batch = key;
                mesh.userData.slot = -1;
                if (!key) {
                    mesh.visible = true;
                    continue;
                }
                mesh.visible = false;
                let list = members.get(key);
                if (!list) {
                    list = [];
                    members.set(key, list);
                }
                mesh.userData.slot = list.length;
                list.push(mesh);
            }

            for (const [key, list] of members) {
                const set = list[0].userData.set;
                const geometry = set.type === 'Truss' ? c.trussGeometry : c.geometry;
                let inst = batches.get(key);
                if (inst && (inst.userData.capacity < list.length
                    || inst.material !== set.materials
                    || inst.geometry !== geometry)) {
                    dropBatch(inst);
                    inst = null;
                }
                if (!inst) {
                    const capacity = Math.max(MIN_BATCH, 2 ** Math.ceil(Math.log2(list.length)));
                    inst = new THREE.InstancedMesh(geometry, set.materials, capacity);
                    inst.userData.capacity = capacity;
                    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                    inst.frustumCulled = false;
                    inst.castShadow = c.shadows;
                    inst.receiveShadow = c.shadows;
                    scene.add(inst);
                    batches.set(key, inst);
                }
                inst.count = list.length;
                for (let i = 0; i < list.length; i++) {
                    list[i].updateWorldMatrix(true, false);
                    inst.setMatrixAt(i, list[i].matrixWorld);
                }
                inst.instanceMatrix.needsUpdate = true;
            }

            for (const [key, inst] of batches) {
                if (members.has(key)) continue;
                dropBatch(inst);
                batches.delete(key);
            }
            c.loose = c.meshList.length - [...members.values()].reduce((n, l) => n + l.length, 0);
        };

        const bumpBatch = (mesh) => {
            const inst = batches.get(mesh.userData.batch);
            if (!inst || mesh.userData.slot < 0) return;
            mesh.updateWorldMatrix(true, false);
            inst.setMatrixAt(mesh.userData.slot, mesh.matrixWorld);
            inst.instanceMatrix.needsUpdate = true;
        };

        const setBatchShadows = (on) => {
            for (const inst of batches.values()) {
                inst.castShadow = on;
                inst.receiveShadow = on;
            }
        };

        // With more than one part selected the gizmo drives this empty pivot, and
        // the parts ride along as its children (attach keeps their world transform).
        const pivot = new THREE.Group();
        scene.add(pivot);
        const resetPivot = () => {
            pivot.position.set(0, 0, 0);
            pivot.rotation.set(0, 0, 0);
            pivot.scale.set(1, 1, 1);
        };

        gizmo.addEventListener('dragging-changed', (e) => {
            orbit.enabled = !e.value;
            const c = ctx.current;
            if (!c || !gizmo.object) return;
            const group = gizmo.object === pivot;
            if (e.value) {
                if (group) for (const m of c.selectedMeshes) pivot.attach(m);
                return;
            }
            if (group) {
                const updates = c.selectedMeshes.map((m) => {
                    scene.attach(m);
                    return { id: m.userData.id, ...readTransform(m) };
                });
                resetPivot();
                c.onTransformMany(updates);
            } else {
                c.onTransform(readTransform(gizmo.object));
            }
        });

        const keys = new Set();
        let flying = false;
        const syncBusy = () => {
            if (busyRef) busyRef.current = flying || drag !== null || !!marquee?.active;
        };
        const setFlying = (v) => {
            flying = v;
            syncBusy();
        };
        const onKeyDown = (e) => {
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
            keys.add(e.code);
            if (drag && e.code === 'KeyR' && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                rotateDrag();
            }
        };
        const onKeyUp = (e) => keys.delete(e.code);
        const onBlur = () => { keys.clear(); setFlying(false); pending = null; hideBand(); };
        const onWindowUp = (e) => { if (e.button === 2) setFlying(false); };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        window.addEventListener('pointerup', onWindowUp);

        const lookDir = new THREE.Vector3();
        const lookSph = new THREE.Spherical();
        const onLook = (e) => {
            if (!flying || ctx.current?.session) return;
            const dist = camera.position.distanceTo(orbit.target) || 30;
            lookDir.subVectors(orbit.target, camera.position).normalize();
            lookSph.setFromVector3(lookDir);
            lookSph.theta -= e.movementX * 0.0025;
            lookSph.phi += e.movementY * 0.0025;
            lookSph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, lookSph.phi));
            lookDir.setFromSpherical(lookSph);
            orbit.target.copy(camera.position).addScaledVector(lookDir, dist);
        };
        window.addEventListener('pointermove', onLook);

        const raycaster = new THREE.Raycaster();
        const down = { x: 0, y: 0 };

        const pointerNdc = new THREE.Vector2();
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const planeHit = new THREE.Vector3();
        let pending = null;
        let drag = null;
        let marquee = null;

        const band = document.createElement('div');
        band.style.cssText = 'position:absolute;display:none;pointer-events:none;'
            + 'border:1px solid #2f7fd9;background:rgba(47,127,217,0.15);';
        mount.appendChild(band);

        const bandRect = (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            return {
                rect,
                x0: Math.min(marquee.x, e.clientX),
                y0: Math.min(marquee.y, e.clientY),
                x1: Math.max(marquee.x, e.clientX),
                y1: Math.max(marquee.y, e.clientY),
            };
        };

        const drawBand = (e) => {
            const r = bandRect(e);
            band.style.left = `${r.x0 - r.rect.left}px`;
            band.style.top = `${r.y0 - r.rect.top}px`;
            band.style.width = `${r.x1 - r.x0}px`;
            band.style.height = `${r.y1 - r.y0}px`;
            band.style.display = 'block';
        };

        const hideBand = () => {
            band.style.display = 'none';
            marquee = null;
            syncBusy();
        };

        const bandPoint = new THREE.Vector3();
        const endBand = (e) => {
            const r = bandRect(e);
            const additive = marquee.additive;
            hideBand();
            const c = ctx.current;
            if (!c) return;
            const ids = [];
            for (const m of c.meshList) {
                m.updateWorldMatrix(true, false);
                bandPoint.setFromMatrixPosition(m.matrixWorld).project(camera);
                if (bandPoint.z < -1 || bandPoint.z > 1) continue;
                const sx = r.rect.left + ((bandPoint.x + 1) / 2) * r.rect.width;
                const sy = r.rect.top + ((1 - bandPoint.y) / 2) * r.rect.height;
                if (sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1) ids.push(m.userData.id);
            }
            c.selectMany(ids, additive);
        };

        const castPointer = (e) => {
            const rect = renderer.domElement.getBoundingClientRect();
            pointerNdc.set(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(pointerNdc, camera);
        };

        const pickMesh = (e) => {
            const c = ctx.current;
            if (!c) return null;
            castPointer(e);
            const hits = raycaster.intersectObjects(c.meshList, false);
            if (!hits.length) return null;
            const tied = hits.filter((h) => h.distance <= hits[0].distance + 0.01);
            const selected = tied.find((h) => c.selectedMeshes.includes(h.object));
            return (selected ?? hits[0]).object;
        };

        const pickBuf = [];
        const pickSurface = (e, exclude) => {
            const c = ctx.current;
            if (!c) return null;
            castPointer(e);
            pickBuf.length = 0;
            for (const m of c.meshList) if (!exclude.has(m)) pickBuf.push(m);
            const hits = raycaster.intersectObjects(pickBuf, false);
            if (hits.length) return hits[0].point.clone();
            return raycaster.ray.intersectPlane(dragPlane, planeHit) ? planeHit.clone() : null;
        };

        const startDrag = (e) => {
            const c = ctx.current;
            const mesh = pending.mesh;
            pending = null;
            if (!c || !c.canEdit) return;

            const inSelection = c.selectedMeshes.includes(mesh);
            const meshes = inSelection ? c.selectedMeshes.slice() : [mesh];
            if (!inSelection) c.setSelectedId(mesh.userData.id, false);

            const exclude = new Set(meshes);
            const hit = pickSurface(e, exclude);
            if (!hit) return;

            const bounds = new THREE.Box3();
            for (const m of meshes) bounds.expandByObject(m);

            drag = {
                meshes,
                exclude,
                index: meshes.indexOf(mesh),
                baseY: bounds.min.y,
                offX: mesh.position.x - hit.x,
                offZ: mesh.position.z - hit.z,
                start: meshes.map((m) => m.position.clone()),
                delta: new THREE.Vector3(),
            };
            orbit.enabled = false;
            syncBusy();
            renderer.domElement.setPointerCapture(e.pointerId);
        };

        const moveDrag = (e) => {
            const c = ctx.current;
            const hit = pickSurface(e, drag.exclude);
            if (!hit || !c) return;
            const grid = c.snapMove;
            let x = hit.x + drag.offX;
            let z = hit.z + drag.offZ;
            if (grid) {
                x = Math.round(x / grid) * grid;
                z = Math.round(z / grid) * grid;
            }
            const y = drag.start[drag.index].y + (hit.y - drag.baseY);
            drag.delta.set(x, y, z).sub(drag.start[drag.index]);
            for (let i = 0; i < drag.meshes.length; i++) {
                drag.meshes[i].position.copy(drag.start[i]).add(drag.delta);
            }
        };

        const rotateDrag = () => {
            const center = new THREE.Vector3();
            for (const p of drag.start) center.add(p);
            center.divideScalar(drag.start.length);
            for (let i = 0; i < drag.meshes.length; i++) {
                const p = drag.start[i];
                const dx = p.x - center.x;
                const dz = p.z - center.z;
                p.x = center.x - dz;
                p.z = center.z + dx;
                drag.meshes[i].rotation.y += Math.PI / 2;
                drag.meshes[i].position.copy(p).add(drag.delta);
            }
            const offX = drag.offX;
            drag.offX = -drag.offZ;
            drag.offZ = offX;
        };

        const endDrag = (e) => {
            pending = null;
            if (!drag) return;
            const moved = drag.meshes;
            drag = null;
            orbit.enabled = true;
            syncBusy();
            if (e && renderer.domElement.hasPointerCapture(e.pointerId)) {
                renderer.domElement.releasePointerCapture(e.pointerId);
            }
            ctx.current?.onTransformMany(
                moved.map((m) => ({ id: m.userData.id, ...readTransform(m) })),
            );
        };

        let longPress = null;
        let longFired = false;

        const onDown = (e) => {
            if (ctx.current?.session) return;
            down.x = e.clientX;
            down.y = e.clientY;
            if (e.button === 2) setFlying(true);
            if (e.button !== 0 || gizmo.dragging || gizmo.axis) return;
            const mesh = e.altKey ? null : pickMesh(e);
            if (mesh && e.pointerType !== 'mouse') {
                longFired = false;
                clearTimeout(longPress);
                longPress = setTimeout(() => {
                    longPress = null;
                    longFired = true;
                    pending = null;
                    ctx.current?.setSelectedId(mesh.userData.id, true, null);
                }, 450);
            }
            if (mesh) {
                pending = { mesh };
                return;
            }
            if (e.pointerType !== 'mouse') return;
            if (e.altKey || ctx.current?.tool === 'select') {
                marquee = { x: e.clientX, y: e.clientY, active: false, additive: e.ctrlKey || e.metaKey };
            }
        };

        const onMove = (e) => {
            if (ctx.current?.session) return;
            if (longPress && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
                clearTimeout(longPress);
                longPress = null;
            }
            if (pending && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) startDrag(e);
            if (drag) moveDrag(e);
            if (marquee) {
                if (!marquee.active && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
                    marquee.active = true;
                    syncBusy();
                    renderer.domElement.setPointerCapture(e.pointerId);
                }
                if (marquee.active) drawBand(e);
            }
        };
        const onUp = (e) => {
            if (ctx.current?.session) return;
            if (e.button !== 0) return;
            clearTimeout(longPress);
            longPress = null;
            if (longFired) {
                longFired = false;
                endDrag(e);
                return;
            }
            if (marquee) {
                const active = marquee.active;
                if (renderer.domElement.hasPointerCapture(e.pointerId)) {
                    renderer.domElement.releasePointerCapture(e.pointerId);
                }
                if (active) {
                    endBand(e);
                    return;
                }
                hideBand();
            }
            endDrag(e);
            if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
            if (gizmo.dragging) return;
            const c = ctx.current;
            if (!c) return;
            const rect = renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(ndc, camera);
            const hits = raycaster.intersectObjects(c.meshList, false);
            c.setSelectedId(
                hits.length ? hits[0].object.userData.id : null,
                e.ctrlKey || e.metaKey,
                hits.length ? snapNormal(hits[0].face?.normal) : null,
            );
        };
        const orbitHost = renderer.domElement.parentElement ?? window;
        const claimTouch = (e) => {
            if (e.pointerType === 'mouse' || ctx.current?.session) return;
            if (gizmo.dragging || gizmo.axis) return;
            orbit.enabled = !pickMesh(e);
        };
        const freeTouch = () => {
            if (!drag && !marquee && !gizmo.dragging) orbit.enabled = true;
        };

        orbitHost.addEventListener('pointerdown', claimTouch, true);
        window.addEventListener('pointerup', freeTouch);
        window.addEventListener('pointercancel', freeTouch);
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointermove', onMove);
        renderer.domElement.addEventListener('pointerup', onUp);

        // Where a newly added part should go: on the ground under the middle of the
        // view, so it lands where the user is looking instead of at the origin. If the
        // camera looks up or at the horizon there is no ground to hit, so drop back to
        // a point a short way in front of it.
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const spawnDir = new THREE.Vector3();
        const spawnHit = new THREE.Vector3();
        const spawnNdc = new THREE.Vector2(0, 0);
        const spawnPoint = (height) => {
            const c = ctx.current;
            raycaster.setFromCamera(spawnNdc, camera);
            const hits = raycaster.intersectObjects(c?.meshList ?? [], false);
            if (hits.length && hits[0].distance <= 400) {
                const p = hits[0].point;
                return [round(p.x), round(p.y + height / 2), round(p.z)];
            }
            camera.getWorldDirection(spawnDir);
            const ray = new THREE.Ray(camera.position.clone(), spawnDir);
            if (!ray.intersectPlane(ground, spawnHit) || camera.position.distanceTo(spawnHit) > 400) {
                spawnHit.copy(camera.position).addScaledVector(spawnDir, 30);
                spawnHit.y = Math.max(spawnHit.y, height / 2);
            } else {
                spawnHit.y = height / 2;
            }
            return [round(spawnHit.x), round(spawnHit.y), round(spawnHit.z)];
        };

        const resize = () => {
            const w = mount.clientWidth;
            const h = mount.clientHeight;
            if (!w || !h) return;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        const applyScale = () => {
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * (gfxRef.current.scale ?? 1));
            resize();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(mount);
        applyScale();

        const fwd = new THREE.Vector3();
        const right = new THREE.Vector3();
        const step = new THREE.Vector3();
        const fly = (dt) => {
            if (!flying) return;
            camera.getWorldDirection(fwd);
            right.crossVectors(fwd, camera.up).normalize();
            step.set(0, 0, 0);
            if (keys.has('KeyW')) step.add(fwd);
            if (keys.has('KeyS')) step.sub(fwd);
            if (keys.has('KeyD')) step.add(right);
            if (keys.has('KeyA')) step.sub(right);
            if (keys.has('KeyE')) step.y += 1;
            if (keys.has('KeyQ')) step.y -= 1;
            if (step.lengthSq() === 0) return;
            const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 120 : 40;
            step.normalize().multiplyScalar(speed * dt);
            camera.position.add(step);
            orbit.target.add(step);
        };

        const viewDir = new THREE.Vector3();
        let raf;
        let last = performance.now();
        let fpsMark = last;
        let fpsCount = 0;
        let fps = 0;
        const countFps = (now) => {
            fpsCount++;
            if (now - fpsMark >= 500) {
                fps = Math.round((fpsCount * 1000) / (now - fpsMark));
                fpsCount = 0;
                fpsMark = now;
            }
        };

        const tick = () => {
            raf = requestAnimationFrame(tick);
            const now = performance.now();
            const dt = Math.min((now - last) / 1000, 0.1);
            last = now;
            if (ctx.current?.session) {
                ctx.current.session.update(dt);
                renderer.render(scene, camera);
                countFps(now);
                return;
            }
            fly(dt);
            orbit.update();
            const c = ctx.current;
            const sel = c?.selectedMeshes ?? [];
            if (drag) {
                for (const m of drag.meshes) bumpBatch(m);
            } else if (gizmo.dragging) {
                for (const m of sel) bumpBatch(m);
            }
            let shown = 0;
            if (sel.length > MAX_OUTLINES) {
                bulkMin.set(Infinity, Infinity, Infinity);
                bulkMax.set(-Infinity, -Infinity, -Infinity);
                for (const m of sel) {
                    const { position: p, scale: s } = m;
                    bulkMin.set(
                        Math.min(bulkMin.x, p.x - s.x / 2),
                        Math.min(bulkMin.y, p.y - s.y / 2),
                        Math.min(bulkMin.z, p.z - s.z / 2),
                    );
                    bulkMax.set(
                        Math.max(bulkMax.x, p.x + s.x / 2),
                        Math.max(bulkMax.y, p.y + s.y / 2),
                        Math.max(bulkMax.z, p.z + s.z / 2),
                    );
                }
                const b = selBoxes[0] ?? selBox();
                bulkPos.addVectors(bulkMin, bulkMax).multiplyScalar(0.5);
                bulkSize.subVectors(bulkMax, bulkMin);
                bulkSize.set(
                    Math.max(bulkSize.x, 0.05),
                    Math.max(bulkSize.y, 0.05),
                    Math.max(bulkSize.z, 0.05),
                );
                b.matrix.compose(bulkPos, IDENTITY_Q, bulkSize);
                b.visible = true;
                shown = 1;
            } else {
                for (let i = 0; i < sel.length; i++) {
                    const b = selBoxes[i] ?? selBox();
                    sel[i].updateWorldMatrix(true, false);
                    b.matrix.copy(sel[i].matrixWorld);
                    b.visible = true;
                }
                shown = sel.length;
            }
            for (let i = shown; i < selBoxes.length; i++) selBoxes[i].visible = false;

            let f = 0;
            if (c?.showFaces) {
                for (const mesh of sel) {
                    const dir = c.faces?.[mesh.userData.id];
                    const local = dir && FACE_MATS.get(faceKey(dir));
                    if (!local) continue;
                    const q = faceQuads[f] ?? faceQuad();
                    f++;
                    mesh.updateWorldMatrix(true, false);
                    faceLocal.multiplyMatrices(mesh.matrixWorld, local);
                    q.matrix.copy(faceLocal);
                    q.visible = true;
                }
            }
            for (let i = f; i < faceQuads.length; i++) faceQuads[i].visible = false;

            let n = 0;
            for (const peer of c?.peers ?? []) {
                if (n >= MAX_OUTLINES) break;
                const mat = peerMat(peer.color);
                for (const id of peer.selection ?? []) {
                    if (n >= MAX_OUTLINES) break;
                    const mesh = c.meshes.get(id);
                    if (!mesh) continue;
                    const b = peerBoxes[n] ?? peerBox();
                    n++;
                    mesh.updateWorldMatrix(true, false);
                    b.matrix.copy(mesh.matrixWorld);
                    b.material = mat;
                    b.visible = true;
                }
            }
            for (let i = n; i < peerBoxes.length; i++) peerBoxes[i].visible = false;

            let k = 0;
            for (const peer of c?.peers ?? []) {
                if (!peer.view) continue;
                const { cone, label } = marks[k] ?? mark();
                k++;
                const [px, py, pz] = peer.view.p;
                const [dx, dy, dz] = peer.view.d;
                cone.position.set(px, py, pz);
                markTarget.set(px + dx, py + dy, pz + dz);
                cone.lookAt(markTarget);
                cone.material = markMat(peer.color);
                cone.visible = true;
                label.position.set(px, py + 2.2, pz);
                label.material = labelMat(peer.name, peer.color);
                label.visible = true;
            }
            for (let i = k; i < marks.length; i++) {
                marks[i].cone.visible = false;
                marks[i].label.visible = false;
            }

            if (c?.onView) {
                camera.getWorldDirection(viewDir);
                c.onView({
                    p: [round(camera.position.x), round(camera.position.y), round(camera.position.z)],
                    d: [round(viewDir.x), round(viewDir.y), round(viewDir.z)],
                });
            }

            renderer.render(scene, camera);

            countFps(now);
            if (c?.statsRef) {
                const info = renderer.info.render;
                c.statsRef.current = {
                    fps,
                    calls: info.calls,
                    triangles: info.triangles,
                    batches: batches.size,
                    loose: c.loose ?? 0,
                    textures: renderer.info.memory.textures,
                    materials: c.sets.size,
                };
            }
        };
        tick();

        const tex = {
            stud: makeStudTexture(),
            inlet: makeInletTexture(),
            spawn: makeSpawnTexture(),
            shirt: makeShirtTexture(),
        };
        const aniso = renderer.capabilities.getMaxAnisotropy();
        for (const t of Object.values(tex)) t.anisotropy = aniso;

        ctx.current = {
            scene, camera, renderer, orbit, gizmo, tex, pivot, spawnPoint,
            sun, grid, applyScale, syncBatches, setBatchShadows,
            isDragging: () => drag !== null,
            isDraggingMesh: (m) => !!drag?.meshes.includes(m),
            snapMove: 0,
            session: null,
            enterPlay: () => {
                gizmo.detach();
                for (const b of selBoxes) b.visible = false;
                for (const b of peerBoxes) b.visible = false;
                for (const q of faceQuads) q.visible = false;
                for (const m of marks) { m.cone.visible = false; m.label.visible = false; }
                grid.visible = false;
                keys.clear();
                setFlying(false);
                orbit.enabled = false;
            },
            leavePlay: () => {
                grid.visible = true;
                keys.clear();
                orbit.enabled = true;
                orbit.target.copy(camera.position).addScaledVector(
                    camera.getWorldDirection(new THREE.Vector3()), 30,
                );
            },
            shadows: gfxRef.current.shadows,
            canEdit: true,
            peers: [],
            meshes: new Map(),
            meshList: [],
            geometry: makePartGeometry(),
            trussGeometry: makeTrussGeometry(),
            sets: makeMaterialSets(tex),
            previewMeshes: [],
            previewMat: new THREE.MeshStandardMaterial({
                color: 0x2f7fd9, transparent: true, opacity: 0.45, depthWrite: false,
            }),
            studsOn: gfxRef.current.studs,
            mode: gfxRef.current.mode ?? 'lit',
            selectedMeshes: [],
            tool: 'select',
            onTransform: () => {},
            onTransformMany: () => {},
            setSelectedId: () => {},
            selectMany: () => {},
            onView: null,
        };

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            orbitHost.removeEventListener('pointerdown', claimTouch, true);
            window.removeEventListener('pointerup', freeTouch);
            window.removeEventListener('pointercancel', freeTouch);
            renderer.domElement.removeEventListener('pointerdown', onDown);
            renderer.domElement.removeEventListener('pointermove', onMove);
            renderer.domElement.removeEventListener('pointerup', onUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('pointerup', onWindowUp);
            window.removeEventListener('pointermove', onLook);
            gizmo.dispose();
            orbit.dispose();
            for (const b of selBoxes) scene.remove(b);
            for (const b of peerBoxes) scene.remove(b);
            for (const { cone, label } of marks) {
                scene.remove(cone);
                scene.remove(label);
            }
            markGeom.dispose();
            for (const m of markMats.values()) m.dispose();
            for (const m of labelMats.values()) {
                m.map.dispose();
                m.dispose();
            }
            for (const m of peerMats.values()) m.dispose();
            for (const q of faceQuads) scene.remove(q);
            faceGeom.dispose();
            faceMat.dispose();
            selEdges.dispose();
            selMat.dispose();
            for (const inst of batches.values()) dropBatch(inst);
            batches.clear();
            for (const t of Object.values(tex)) t.dispose();
            ctx.current.sets.dispose();
            ctx.current.geometry.dispose();
            ctx.current.trussGeometry.dispose();
            for (const m of ctx.current.previewMeshes) scene.remove(m);
            ctx.current.previewMat.dispose();
            renderer.dispose();
            band.remove();
            mount.removeChild(renderer.domElement);
            ctx.current = null;
        };
    }, []);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        c.onTransform = onTransform;
        c.onTransformMany = onTransformMany;
        c.setSelectedId = setSelectedId;
        c.selectMany = selectMany ?? (() => {});
        c.tool = tool;
        c.snapMove = snap.moveOn ? snap.move : 0;
        c.canEdit = canEdit;
        c.peers = peers ?? [];
        c.faces = faces ?? null;
        c.showFaces = showFaces;
        c.onView = onView ?? null;
        if (spawnRef) spawnRef.current = c.spawnPoint;
    });

    useEffect(() => {
        const c = ctx.current;
        if (!c || !playing) return undefined;
        let cancelled = false;
        let session = null;
        if (busyRef) busyRef.current = true;
        c.enterPlay();
        import('./play/session').then(({ createSession }) => {
            if (cancelled || !ctx.current) return;
            session = createSession({
                scene: c.scene,
                camera: c.camera,
                canvas: c.renderer.domElement,
                parts: partsRef.current,
                onExit: onExitPlay,
            });
            ctx.current.session = session;
            if (touchRef) touchRef.current = session.touch;
        });
        return () => {
            cancelled = true;
            if (touchRef) touchRef.current = null;
            if (ctx.current) {
                ctx.current.session = null;
                ctx.current.leavePlay();
            }
            if (busyRef) busyRef.current = false;
            session?.dispose();
        };
    }, [playing]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        const g = graphics;
        const shadows = g.shadows && (g.mode ?? 'lit') === 'lit';
        const was = c.shadows;
        c.shadows = shadows;
        c.renderer.shadowMap.enabled = shadows;
        c.sun.castShadow = shadows;
        c.grid.visible = g.grid;
        if (c.sun.shadow.mapSize.x !== g.shadowRes) {
            c.sun.shadow.mapSize.set(g.shadowRes, g.shadowRes);
            c.sun.shadow.map?.dispose();
            c.sun.shadow.map = null;
        }
        for (const mesh of c.meshes.values()) {
            mesh.castShadow = shadows;
            mesh.receiveShadow = shadows;
            if (was === shadows) continue;
            const mats = mesh.material;
            for (const m of Array.isArray(mats) ? mats : [mats]) m.needsUpdate = true;
        }
        c.setBatchShadows(shadows);
        c.renderer.shadowMap.needsUpdate = true;
        c.applyScale();
    }, [graphics]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        const rebuild = c.studsOn !== studs || c.mode !== mode;
        const alive = new Set();

        const setMaterials = (mesh, part) => {
            const want = c.sets.acquire(part, mode, studs);
            const had = mesh.userData.set;
            if (had === want) {
                c.sets.release(want);
            } else {
                if (had) c.sets.release(had);
                mesh.userData.set = want;
                mesh.material = want.materials;
            }
            return want;
        };

        for (const part of parts) {
            alive.add(part._id);
            let mesh = c.meshes.get(part._id);
            if (!mesh) {
                mesh = new THREE.Mesh(c.geometry, PLACEHOLDER);
                mesh.castShadow = c.shadows;
                mesh.receiveShadow = c.shadows;
                mesh.userData.id = part._id;
                c.scene.add(mesh);
                c.meshes.set(part._id, mesh);
            } else {
                if (!rebuild && mesh.userData.part === part) continue;
                const held = c.gizmo.dragging
                    ? (c.gizmo.object === mesh || mesh.parent === c.pivot)
                    : c.isDraggingMesh(mesh);
                if (held) {
                    mesh.userData.part = part;
                    setMaterials(mesh, part);
                    continue;
                }
            }
            mesh.userData.part = part;
            mesh.position.set(part.P[0], part.P[1], part.P[2]);
            mesh.scale.set(part.S[0], part.S[1], part.S[2]);
            mesh.rotation.set(part.R[0] * DEG, part.R[1] * DEG, part.R[2] * DEG);

            setMaterials(mesh, part);

            const geometry = partType(part) === 'Truss' ? c.trussGeometry : c.geometry;
            if (mesh.geometry !== geometry) mesh.geometry = geometry;
        }
        c.studsOn = studs;
        c.mode = mode;

        let removed = false;
        for (const [id, mesh] of c.meshes) {
            if (!alive.has(id)) {
                if (c.gizmo.object === mesh) c.gizmo.detach();
                mesh.removeFromParent();
                c.sets.release(mesh.userData.set);
                mesh.userData.set = null;
                c.meshes.delete(id);
                removed = true;
            }
        }
        if (removed || c.meshList.length !== c.meshes.size) {
            c.meshList = [...c.meshes.values()];
        }
        c.syncBatches();
    }, [parts, studs, mode]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        const list = Array.isArray(preview) ? preview : (preview ? [preview] : []);
        const shown = Math.min(list.length, MAX_PREVIEWS);
        for (let i = 0; i < shown; i++) {
            let mesh = c.previewMeshes[i];
            if (!mesh) {
                mesh = new THREE.Mesh(c.geometry, c.previewMat);
                c.scene.add(mesh);
                c.previewMeshes.push(mesh);
            }
            const p = list[i];
            mesh.visible = true;
            mesh.position.set(p.P[0], p.P[1], p.P[2]);
            mesh.scale.set(p.S[0], p.S[1], p.S[2]);
            mesh.rotation.set(p.R[0] * DEG, p.R[1] * DEG, p.R[2] * DEG);
        }
        for (let i = shown; i < c.previewMeshes.length; i++) c.previewMeshes[i].visible = false;
    }, [preview]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        if (c.gizmo.dragging) return;
        const meshes = selectedIds.map((id) => c.meshes.get(id)).filter(Boolean);
        c.selectedMeshes = meshes;
        const mode = canEdit ? TOOL_MODE[tool] : null;
        if (!meshes.length || !mode) {
            c.gizmo.detach();
        } else if (meshes.length === 1) {
            c.gizmo.setMode(mode);
            c.gizmo.attach(meshes[0]);
        } else {
            // Park the pivot at the centre of the selection so the gizmo sits there.
            const center = new THREE.Vector3();
            for (const m of meshes) center.add(m.position);
            center.divideScalar(meshes.length);
            c.pivot.position.copy(center);
            c.pivot.rotation.set(0, 0, 0);
            c.pivot.scale.set(1, 1, 1);
            c.gizmo.setMode(mode);
            c.gizmo.attach(c.pivot);
        }
    }, [selectedIds, tool, parts, canEdit]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        c.gizmo.translationSnap = snap.moveOn ? snap.move : null;
        c.gizmo.rotationSnap = snap.rotateOn ? snap.rotate * DEG : null;
        c.gizmo.setScaleSnap(snap.moveOn ? snap.move : null);
    }, [snap]);

    useEffect(() => {
        const c = ctx.current;
        if (!c || !mapName) return;
        const box = new THREE.Box3();
        for (const p of partsRef.current) {
            box.expandByPoint(new THREE.Vector3(p.P[0], p.P[1], p.P[2]));
        }
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = Math.max(box.getSize(new THREE.Vector3()).length(), 40);
        c.orbit.target.copy(center);
        c.camera.position.copy(center).add(new THREE.Vector3(0.5, 0.6, 0.5).multiplyScalar(size));
    }, [mapName]);

    return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />;
}
