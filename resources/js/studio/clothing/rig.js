import * as THREE from 'three';
import { applyFace, loadFace, makeFaceTexture } from '../play/character';

export const TEMPLATE_SIZE = 512;
export const DEFAULT_SKIN = '#d8b48a';

const BASE = '/play';

const SLEEVES = ['leftArm', 'rightArm'];
const LEGS = ['leftLeg', 'rightLeg'];

let loaderPromise = null;

function getLoader() {
    if (!loaderPromise) {
        loaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js')
            .then(({ GLTFLoader }) => new GLTFLoader());
    }
    return loaderPromise;
}

const load = (loader, url) => new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
});

function classify(mesh) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const x = (box.min.x + box.max.x) / 2;
    if (box.min.y > 3.9) return 'head';
    if (box.min.y >= 1.5) {
        if (Math.abs(x) < 0.8) return 'torso';
        return x < 0 ? 'leftArm' : 'rightArm';
    }
    return x < 0 ? 'leftLeg' : 'rightLeg';
}

function texture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

function bake(layers, skin) {
    const canvas = document.createElement('canvas');
    canvas.width = TEMPLATE_SIZE;
    canvas.height = TEMPLATE_SIZE;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = skin;
    g.fillRect(0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);
    for (const image of layers) g.drawImage(image, 0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE);

    return texture(canvas);
}

function posedBounds(object) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    object.traverse((o) => {
        if (!o.isMesh) return;
        const count = o.geometry.attributes.position.count;
        for (let i = 0; i < count; i++) {
            if (o.isSkinnedMesh) o.getVertexPosition(i, point);
            else point.fromBufferAttribute(o.geometry.attributes.position, i);
            box.expandByPoint(point.applyMatrix4(o.matrixWorld));
        }
    });

    return box;
}

export async function loadRig() {
    const loader = await getLoader();
    await loadFace();
    const gltf = await load(loader, `${BASE}/male.glb`);
    const idle = await load(loader, `${BASE}/idle.glb`)
        .then((g) => g.animations?.[0] ?? null)
        .catch(() => null);

    const object = gltf.scene;
    const parts = {};
    const meshes = {};

    object.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = true;
        o.receiveShadow = true;
        const material = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
        if (material.vertexColors) applyFace(material, makeFaceTexture());
        o.material = material;
        const name = classify(o);
        parts[name] = material;
        meshes[name] = o;
    });

    let mixer = null;
    if (idle) {
        mixer = new THREE.AnimationMixer(object);
        mixer.clipAction(idle).play();
        mixer.update(0);
    }

    const box = posedBounds(object);
    object.position.x -= (box.min.x + box.max.x) / 2;
    object.position.z -= (box.min.z + box.max.z) / 2;
    object.position.y -= box.min.y;

    object.updateMatrixWorld(true);
    const bone = object.getObjectByName('Head');
    const anchor = bone && meshes.head ? (() => {
        const head = posedBounds(meshes.head);

        return {
            at: new THREE.Vector3(
                (head.min.x + head.max.x) / 2,
                head.max.y,
                (head.min.z + head.max.z) / 2,
            ),
            wide: head.max.x - head.min.x,
            toBone: new THREE.Matrix4().copy(bone.matrixWorld).invert(),
        };
    })() : null;
    let hat = null;

    const dropHat = () => {
        if (!hat) return;
        for (const child of [...hat.children]) child.removeFromParent();
        hat.removeFromParent();
        hat = null;
    };

    return {
        object,
        parts,
        height: box.max.y - box.min.y,
        setHat(model, tune = {}) {
            dropHat();
            if (!model || !anchor) return;

            const { size: mul = 1, up = 0, forward = 0, rotation = 0 } = tune;

            model.removeFromParent();
            model.position.set(0, 0, 0);
            model.updateMatrixWorld(true);
            const own = new THREE.Box3().setFromObject(model);
            const size = own.getSize(new THREE.Vector3());
            const scale = (anchor.wide / (Math.max(size.x, size.z) || 1)) * mul;

            model.position.sub(own.getCenter(new THREE.Vector3()));
            model.position.y += size.y / 2;

            const holder = new THREE.Group();
            holder.add(model);
            holder.scale.setScalar(scale);
            holder.rotation.y = (rotation * Math.PI) / 180;
            holder.position.set(anchor.at.x, anchor.at.y + up, anchor.at.z - forward);
            holder.applyMatrix4(anchor.toBone);
            holder.traverse((o) => {
                if (o.isMesh) o.castShadow = true;
            });

            bone.add(holder);
            hat = holder;
        },
        update(dt) {
            mixer?.update(dt);
        },
        dispose() {
            dropHat();
            mixer?.stopAllAction();
            object.traverse((o) => {
                if (!o.isMesh) return;
                o.geometry.dispose();
                o.material.map?.dispose();
                o.material.dispose();
            });
        },
    };
}

function wear(rig, names, layers, skin) {
    const tex = layers.length ? bake(layers, skin) : null;
    for (const name of names) {
        const material = rig.parts[name];
        if (!material) continue;
        material.map?.dispose();
        material.map = tex;
        if (tex) material.color.setRGB(1, 1, 1);
        else material.color.set(skin);
        material.needsUpdate = true;
    }
}

export function apply(rig, { shirt, pants, skin }) {
    const head = rig.parts.head;
    if (head) {
        head.color.set(skin);
        head.needsUpdate = true;
    }

    wear(rig, ['torso'], [pants, shirt].filter(Boolean), skin);
    wear(rig, SLEEVES, shirt ? [shirt] : [], skin);
    wear(rig, LEGS, pants ? [pants] : [], skin);
}

export function readTemplate(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('That file is not an image the browser can read.'));
        };
        image.src = url;
    });
}
