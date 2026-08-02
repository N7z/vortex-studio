import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_SKIN, TEMPLATE_SIZE, apply, loadRig, readTemplate } from './rig';

export default function Clothing() {
    const mountRef = useRef(null);
    const rigRef = useRef(null);
    const inputRef = useRef(null);
    const [item, setItem] = useState(null);
    const [over, setOver] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('Loading the character...');
    const [spin, setSpin] = useState(true);
    const spinRef = useRef(spin);
    spinRef.current = spin;
    const [skin, setSkin] = useState(DEFAULT_SKIN);
    const lookRef = useRef(null);
    lookRef.current = { image: item, skin };

    useEffect(() => {
        const mount = mountRef.current;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x101016);

        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
        camera.position.set(0, 3.2, 12);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x33333a, 1.1));
        const sun = new THREE.DirectionalLight(0xffffff, 1.7);
        sun.position.set(4, 10, 8);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
        sun.shadow.camera.right = sun.shadow.camera.top = 8;
        sun.shadow.normalBias = 0.05;
        scene.add(sun);
        const rim = new THREE.DirectionalLight(0x8fb4ff, 0.5);
        rim.position.set(-6, 4, -8);
        scene.add(rim);

        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2),
            new THREE.ShadowMaterial({ opacity: 0.35 }),
        );
        floor.receiveShadow = true;
        scene.add(floor);
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(5.85, 6, 64).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x2a2a34 }),
        );
        scene.add(ring);

        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enablePan = false;
        orbit.minDistance = 5;
        orbit.maxDistance = 20;
        orbit.maxPolarAngle = Math.PI * 0.52;
        orbit.enableDamping = true;
        orbit.target.set(0, 2.6, 0);

        const holder = new THREE.Group();
        holder.rotation.y = Math.PI;
        scene.add(holder);

        let alive = true;
        loadRig()
            .then((rig) => {
                if (!alive) {
                    rig.dispose();
                    return;
                }
                rigRef.current = rig;
                holder.add(rig.object);
                apply(rig, lookRef.current);
                const fit = (rig.height / 2) / Math.tan((camera.fov * Math.PI) / 360);
                orbit.target.set(0, rig.height / 2, 0);
                camera.position.set(0, rig.height * 0.55, fit * 1.5);
                setStatus('');
            })
            .catch(() => setStatus('The character model could not be loaded.'));

        const resize = () => {
            const w = mount.clientWidth;
            const h = mount.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(mount);

        const clock = new THREE.Clock();
        renderer.setAnimationLoop(() => {
            const dt = clock.getDelta();
            rigRef.current?.update(dt);
            if (spinRef.current) holder.rotation.y += dt * 0.5;
            orbit.update();
            renderer.render(scene, camera);
        });

        return () => {
            alive = false;
            renderer.setAnimationLoop(null);
            ro.disconnect();
            orbit.dispose();
            rigRef.current?.dispose();
            rigRef.current = null;
            floor.geometry.dispose();
            floor.material.dispose();
            ring.geometry.dispose();
            ring.material.dispose();
            renderer.dispose();
            mount.removeChild(renderer.domElement);
        };
    }, []);

    useEffect(() => {
        if (rigRef.current) apply(rigRef.current, { image: item, skin });
    }, [item, skin]);

    const pick = async (file) => {
        if (!file) return;
        setError('');
        try {
            const image = await readTemplate(file);
            image.name = file.name;
            setItem(image);
            if (image.width !== image.height) {
                setError(`${file.name} is ${image.width}x${image.height}. A template is square, `
                    + `${TEMPLATE_SIZE}x${TEMPLATE_SIZE}, so this one will look stretched.`);
            }
        } catch (err) {
            setError(String(err.message ?? err));
        }
    };

    return (
        <div className="ugc">
            <div className="ugc-side">
                <div className="ugc-slot">
                    <div className="ugc-slot-head">
                        <span className="ugc-slot-name">Clothing template</span>
                        {item && (
                            <button
                                type="button"
                                className="ugc-clear"
                                onClick={() => { setItem(null); setError(''); }}
                            >
                                Remove
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        className={over ? 'ugc-drop over' : 'ugc-drop'}
                        onClick={() => inputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                        onDragLeave={() => setOver(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setOver(false);
                            pick(e.dataTransfer.files?.[0]);
                        }}
                    >
                        {item ? (
                            <img src={item.src} alt="Clothing template" />
                        ) : (
                            <span className="ugc-drop-hint">
                                Drop a {TEMPLATE_SIZE}x{TEMPLATE_SIZE} PNG, or click to choose
                            </span>
                        )}
                    </button>
                    <p className="ugc-slot-note">
                        {item ? `${item.name} - ${item.width}x${item.height}` : 'Torso, arms and legs'}
                    </p>
                </div>
                <div className="ugc-slot">
                    <div className="ugc-slot-head">
                        <span className="ugc-slot-name">Skin</span>
                        <input
                            className="ugc-skin"
                            type="color"
                            value={skin}
                            onChange={(e) => setSkin(e.target.value)}
                        />
                    </div>
                    <label className="arch-check ugc-turntable">
                        <input
                            type="checkbox"
                            checked={spin}
                            onChange={(e) => setSpin(e.target.checked)}
                        />
                        Turntable
                    </label>
                </div>
                {error && <p className="ugc-error">{error}</p>}
            </div>

            <div className="ugc-view">
                <div className="ugc-canvas" ref={mountRef} />
                {status && <div className="ugc-status">{status}</div>}
            </div>

            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/*"
                style={{ display: 'none' }}
                onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
            />
        </div>
    );
}
