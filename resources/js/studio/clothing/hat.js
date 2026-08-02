import * as THREE from 'three';

const KINDS = {
    glb: 'gltf',
    gltf: 'gltf',
    fbx: 'fbx',
    obj: 'obj',
};

export const HAT_TYPES = Object.keys(KINDS).map((e) => `.${e}`).join(',');

async function parse(kind, buffer, url) {
    if (kind === 'gltf') {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().parseAsync(buffer, '');

        return gltf.scene;
    }
    if (kind === 'fbx') {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

        return new FBXLoader().parse(buffer, '');
    }
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');

    return new OBJLoader().parse(new TextDecoder().decode(buffer), url);
}

export async function readHat(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const kind = KINDS[ext];
    if (!kind) throw new Error(`${ext} is not a 3D file this can read. Use glb, gltf, fbx or obj.`);

    const model = await parse(kind, await file.arrayBuffer(), file.name);
    let meshes = 0;
    model.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        o.frustumCulled = false;
        if (!o.material) o.material = new THREE.MeshStandardMaterial({ color: 0x9a9aa4 });
    });
    if (!meshes) throw new Error('That file has no geometry in it.');

    return model;
}
