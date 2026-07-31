import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BODY_HEIGHT, FEET_OFFSET } from './movement';

const BASE = '/play';
const CLIPS = ['idle', 'walk', 'jump', 'fall'];

// Stepping off a lip leaves the ground for a frame or two. With GRAVITY at -196.2 this
// is about a one stud drop, below which the walk keeps playing instead of the fall.
const FALL_SPEED = 20;

const falling = (state) => !state.grounded && state.vy < -FALL_SPEED;
const airborne = (state) => !state.grounded && (state.vy > 0 || falling(state));
const BLEND = 0.15;

function makeFaceTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    g.fillStyle = '#1b1b1b';

    const eye = (x) => {
        g.beginPath();
        g.ellipse(x * size, 0.36 * size, 0.052 * size, 0.075 * size, 0, 0, Math.PI * 2);
        g.fill();
    };
    eye(0.355);
    eye(0.645);

    g.lineWidth = 0.035 * size;
    g.lineCap = 'round';
    g.strokeStyle = '#1b1b1b';
    g.beginPath();
    g.arc(0.5 * size, 0.55 * size, 0.16 * size, 0.18 * Math.PI, 0.82 * Math.PI);
    g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

function applyFace(material, tex) {
    material.defines = { ...material.defines, USE_UV: '' };
    material.onBeforeCompile = (shader) => {
        shader.uniforms.faceMap = { value: tex };
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D faceMap;')
            .replace(
                '#include <color_fragment>',
                'vec4 faceTexel = texture2D( faceMap, vUv );\n'
                + 'diffuseColor.rgb = mix( diffuseColor.rgb, faceTexel.rgb,'
                + ' faceTexel.a * step( 0.5, vColor.r ) );',
            );
    };
    material.needsUpdate = true;
}

function fallbackRig() {
    const root = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xf3c48b });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x3f7fbf });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2f5f3f });

    const box = (w, h, d, mat, x, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        root.add(m);
        return m;
    };

    box(2, 1, 1, skin, 0, 4.5, 0);
    box(2, 2, 1, shirt, 0, 3, 0);
    const arms = [box(1, 2, 1, skin, -1.5, 3, 0), box(1, 2, 1, skin, 1.5, 3, 0)];
    const legs = [box(1, 2, 1, pants, -0.5, 1, 0), box(1, 2, 1, pants, 0.5, 1, 0)];

    return {
        object: root,
        setPose(t, moving, airborne) {
            const swing = airborne ? 0 : Math.sin(t * 9) * (moving ? 0.7 : 0);
            legs[0].rotation.x = swing;
            legs[1].rotation.x = -swing;
            arms[0].rotation.x = airborne ? -2.6 : -swing;
            arms[1].rotation.x = airborne ? -2.6 : swing;
        },
    };
}

let loaderPromise = null;

function getLoader() {
    if (!loaderPromise) {
        loaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js')
            .then(({ GLTFLoader }) => new GLTFLoader());
    }
    return loaderPromise;
}

function load(loader, url) {
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function blocks() {
    const rig = fallbackRig();
    return {
        object: rig.object,
        fallback: true,
        update(dt, state, t) {
            rig.setPose(t, state.moving, airborne(state));
        },
        dispose() {},
    };
}

let assets = null;

function loadAssets() {
    if (assets) return assets;
    assets = (async () => {
        const loader = await getLoader();
        const body = await load(loader, `${BASE}/male.glb`);
        const clips = await Promise.all(CLIPS.map((name) => load(loader, `${BASE}/${name}.glb`)
            .then((gltf) => gltf.animations?.[0] ?? null)
            .catch(() => null)));

        const faceTex = makeFaceTexture();
        body.scene.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.frustumCulled = false;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (!m || !m.vertexColors) continue;
                applyFace(m, faceTex);
            }
        });

        return { body, clips };
    })();
    assets.catch(() => { assets = null; });

    return assets;
}

export async function createCharacter() {
    let loaded;
    try {
        loaded = await loadAssets();
    } catch {
        return blocks();
    }

    const object = SkeletonUtils.clone(loaded.body.scene);

    const box = new THREE.Box3().setFromObject(object);
    const height = box.max.y - box.min.y;
    if (height > 0.01) object.scale.setScalar(BODY_HEIGHT / height);
    object.position.y = -box.min.y * object.scale.y;

    const holder = new THREE.Group();
    holder.add(object);

    const mixer = new THREE.AnimationMixer(object);
    const actions = {};
    let current = null;

    const play = (name) => {
        const next = actions[name];
        if (!next || next === current) return;
        next.reset().setEffectiveWeight(1).fadeIn(BLEND).play();
        if (current) current.fadeOut(BLEND);
        current = next;
    };

    CLIPS.forEach((name, i) => {
        const clip = loaded.clips[i];
        if (!clip) return;
        const action = mixer.clipAction(clip);
        if (name === 'jump') {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        actions[name] = action;
    });
    play('idle');

    return {
        object: holder,
        fallback: false,
        update(dt, state) {
            if (!state.grounded && state.vy > 0) play('jump');
            else if (falling(state)) play('fall');
            else if (state.grounded) play(state.moving ? 'walk' : 'idle');
            mixer.update(dt);
        },
        dispose() {
            mixer.stopAllAction();
            mixer.uncacheRoot(object);
        },
    };
}

export function placeCharacter(character, state) {
    character.object.position.set(state.x, state.y - FEET_OFFSET, state.z);
    character.object.rotation.y = state.yaw;
}
