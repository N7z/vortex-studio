import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const TOOL_MODE = { move: 'translate', rotate: 'rotate', scale: 'scale' };
const DEG = Math.PI / 180;

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

export default function Viewport({ parts, selectedId, setSelectedId, tool, snap, onTransform, mapName, studs, preview }) {
    const mountRef = useRef(null);
    const ctx = useRef(null);
    const partsRef = useRef(parts);
    partsRef.current = parts;

    useEffect(() => {
        const mount = mountRef.current;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x7ec8e8);

        const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 5000);
        camera.position.set(40, 40, 40);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
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
        orbit.target.set(0, 0, 0);

        const gizmo = new TransformControls(camera, renderer.domElement);
        scene.add(gizmo.getHelper());

        const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x2f7fd9);
        selBox.visible = false;
        selBox.material.depthTest = false;
        selBox.material.depthWrite = false;
        selBox.renderOrder = 999;
        scene.add(selBox);

        gizmo.addEventListener('dragging-changed', (e) => {
            orbit.enabled = !e.value;
            const c = ctx.current;
            if (!e.value && gizmo.object && c) {
                const m = gizmo.object;
                c.onTransform({
                    P: [round(m.position.x), round(m.position.y), round(m.position.z)],
                    R: [round(m.rotation.x / DEG), round(m.rotation.y / DEG), round(m.rotation.z / DEG)],
                    S: [
                        Math.max(round(m.scale.x), 0.05),
                        Math.max(round(m.scale.y), 0.05),
                        Math.max(round(m.scale.z), 0.05),
                    ],
                });
            }
        });

        const keys = new Set();
        let flying = false;
        const onKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            keys.add(e.code);
        };
        const onKeyUp = (e) => keys.delete(e.code);
        const onBlur = () => { keys.clear(); flying = false; };
        const onWindowUp = (e) => { if (e.button === 2) flying = false; };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        window.addEventListener('pointerup', onWindowUp);

        const lookDir = new THREE.Vector3();
        const lookSph = new THREE.Spherical();
        const onLook = (e) => {
            if (!flying) return;
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
        const onDown = (e) => {
            down.x = e.clientX;
            down.y = e.clientY;
            if (e.button === 2) flying = true;
        };
        const onUp = (e) => {
            if (e.button !== 0) return;
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
            const hits = raycaster.intersectObjects(c.meshes ? [...c.meshes.values()] : [], false);
            c.setSelectedId(hits.length ? hits[0].object.userData.id : null);
        };
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointerup', onUp);

        const resize = () => {
            const w = mount.clientWidth;
            const h = mount.clientHeight;
            if (!w || !h) return;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        const ro = new ResizeObserver(resize);
        ro.observe(mount);
        resize();

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

        let raf;
        let last = performance.now();
        const tick = () => {
            raf = requestAnimationFrame(tick);
            const now = performance.now();
            fly(Math.min((now - last) / 1000, 0.1));
            last = now;
            orbit.update();
            const c = ctx.current;
            const sel = c?.selectedMesh;
            if (sel) {
                selBox.box.setFromObject(sel);
                selBox.visible = true;
            } else {
                selBox.visible = false;
            }
            renderer.render(scene, camera);
        };
        tick();

        const studTex = makeStudTexture();
        const inletTex = makeInletTexture();
        const aniso = renderer.capabilities.getMaxAnisotropy();
        studTex.anisotropy = aniso;
        inletTex.anisotropy = aniso;

        ctx.current = {
            scene, camera, renderer, orbit, gizmo, studTex, inletTex,
            meshes: new Map(),
            geometry: new THREE.BoxGeometry(1, 1, 1),
            selectedMesh: null,
            onTransform: () => {},
            setSelectedId: () => {},
        };

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            renderer.domElement.removeEventListener('pointerdown', onDown);
            renderer.domElement.removeEventListener('pointerup', onUp);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('pointerup', onWindowUp);
            window.removeEventListener('pointermove', onLook);
            gizmo.dispose();
            orbit.dispose();
            studTex.dispose();
            inletTex.dispose();
            ctx.current.previewMesh?.material.dispose();
            renderer.dispose();
            mount.removeChild(renderer.domElement);
            ctx.current = null;
        };
    }, []);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        c.onTransform = onTransform;
        c.setSelectedId = setSelectedId;
    });

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        const alive = new Set();
        for (const part of parts) {
            alive.add(part._id);
            let mesh = c.meshes.get(part._id);
            if (!mesh) {
                const base = new THREE.MeshStandardMaterial();
                const studMap = c.studTex.clone();
                const inletMap = c.inletTex.clone();
                const top = new THREE.MeshStandardMaterial({ map: studMap });
                const bottom = new THREE.MeshStandardMaterial({ map: inletMap });
                mesh = new THREE.Mesh(c.geometry, [base, base, top, bottom, base, base]);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData.id = part._id;
                mesh.userData.base = base;
                mesh.userData.top = top;
                mesh.userData.bottom = bottom;
                mesh.userData.studMap = studMap;
                mesh.userData.inletMap = inletMap;
                c.scene.add(mesh);
                c.meshes.set(part._id, mesh);
            }
            if (!c.gizmo.dragging || c.gizmo.object !== mesh) {
                mesh.position.set(part.P[0], part.P[1], part.P[2]);
                mesh.scale.set(part.S[0], part.S[1], part.S[2]);
                mesh.rotation.set(part.R[0] * DEG, part.R[1] * DEG, part.R[2] * DEG);
            }
            const { base, top, bottom, studMap, inletMap } = mesh.userData;
            const tr = part.Tr ?? 0;
            const wantTransparent = tr > 0;
            for (const m of [base, top, bottom]) {
                m.color.set(`#${part.C ?? 'a3a2a5'}`);
                if (m.transparent !== wantTransparent) {
                    m.transparent = wantTransparent;
                    m.needsUpdate = true;
                }
                m.opacity = 1 - tr;
            }
            const rx = Math.max(1, Math.round(part.S[0]));
            const rz = Math.max(1, Math.round(part.S[2]));
            studMap.repeat.set(rx, rz);
            inletMap.repeat.set(rx, rz);
            for (const [m, map] of [[top, studMap], [bottom, inletMap]]) {
                const wantMap = studs ? map : null;
                if (m.map !== wantMap) {
                    m.map = wantMap;
                    m.needsUpdate = true;
                }
            }
        }
        for (const [id, mesh] of c.meshes) {
            if (!alive.has(id)) {
                if (c.gizmo.object === mesh) c.gizmo.detach();
                c.scene.remove(mesh);
                mesh.userData.studMap.dispose();
                mesh.userData.inletMap.dispose();
                mesh.userData.top.dispose();
                mesh.userData.bottom.dispose();
                mesh.userData.base.dispose();
                c.meshes.delete(id);
            }
        }
    }, [parts, studs]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        if (preview) {
            if (!c.previewMesh) {
                c.previewMesh = new THREE.Mesh(c.geometry, new THREE.MeshStandardMaterial({
                    color: 0x2f7fd9,
                    transparent: true,
                    opacity: 0.45,
                    depthWrite: false,
                }));
                c.scene.add(c.previewMesh);
            }
            c.previewMesh.visible = true;
            c.previewMesh.position.set(preview.P[0], preview.P[1], preview.P[2]);
            c.previewMesh.scale.set(preview.S[0], preview.S[1], preview.S[2]);
            c.previewMesh.rotation.set(preview.R[0] * DEG, preview.R[1] * DEG, preview.R[2] * DEG);
        } else if (c.previewMesh) {
            c.previewMesh.visible = false;
        }
    }, [preview]);

    useEffect(() => {
        const c = ctx.current;
        if (!c) return;
        const mesh = selectedId != null ? c.meshes.get(selectedId) : null;
        c.selectedMesh = mesh ?? null;
        const mode = TOOL_MODE[tool];
        if (mesh && mode) {
            c.gizmo.setMode(mode);
            c.gizmo.attach(mesh);
        } else {
            c.gizmo.detach();
        }
    }, [selectedId, tool, parts]);

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
