import { createCharacter, placeCharacter } from './character';
import { createBodyAudio } from './audio';
import { peerLabel } from './label';

const SMOOTH = 18;

const LABEL_HEIGHT = 3.4;

const shortestAngle = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function createPeers(scene, audio = null) {
    const peers = new Map();
    let disposed = false;
    let elapsed = 0;

    const drop = (peer) => {
        peer.sound?.dispose();
        peer.sound = null;
        if (peer.label) {
            scene.remove(peer.label);
            peer.label.material.map?.dispose();
            peer.label.material.dispose();
            peer.label = null;
        }
        if (!peer.character) return;
        scene.remove(peer.character.object);
        peer.character.dispose();
        peer.character = null;
    };

    return {
        get count() {
            return peers.size;
        },
        set(states, who = null) {
            for (const [id, play] of states) {
                if (!play) continue;
                const named = who?.get(id) ?? null;
                const peer = peers.get(id);
                if (peer) {
                    peer.target = play;
                    if (named && peer.name !== named.name) {
                        if (peer.label) scene.remove(peer.label);
                        peer.name = named.name;
                        peer.label = peerLabel(named.name, named.color);
                        scene.add(peer.label);
                    }
                    continue;
                }
                const added = {
                    target: play,
                    shown: { ...play, vy: 0 },
                    character: null,
                    name: named?.name ?? null,
                    label: null,
                    sound: audio ? createBodyAudio(audio, scene) : null,
                };
                if (named) {
                    added.label = peerLabel(named.name, named.color);
                    scene.add(added.label);
                }
                peers.set(id, added);
                createCharacter().then((c) => {
                    if (disposed || peers.get(id) !== added) {
                        c.dispose();

                        return;
                    }
                    added.character = c;
                    scene.add(c.object);
                });
            }
            for (const [id, peer] of peers) {
                if (states.has(id)) continue;
                drop(peer);
                peers.delete(id);
            }
        },
        step(dt) {
            elapsed += dt;
            const k = 1 - Math.exp(-dt * SMOOTH);
            for (const peer of peers.values()) {
                const { shown, target } = peer;
                const before = shown.y;
                const beforeX = shown.x;
                const beforeZ = shown.z;
                const wasGrounded = shown.grounded;
                shown.x += (target.x - shown.x) * k;
                shown.y += (target.y - shown.y) * k;
                shown.z += (target.z - shown.z) * k;
                shown.yaw += (shortestAngle(shown.yaw, target.yaw) - shown.yaw) * k;
                shown.vy = dt > 0 ? (shown.y - before) / dt : 0;
                shown.moving = target.moving;
                shown.grounded = target.grounded;
                shown.dead = target.dead;
                shown.speed = dt > 0 ? Math.hypot(shown.x - beforeX, shown.z - beforeZ) / dt : 0;
                shown.jumped = wasGrounded && !shown.grounded && shown.vy > 0;
                shown.landed = !wasGrounded && shown.grounded;
                if (peer.label) {
                    peer.label.position.set(shown.x, shown.y + LABEL_HEIGHT, shown.z);
                    peer.label.visible = !shown.dead;
                }
                if (shown.dead) peer.sound?.silence();
                else peer.sound?.step(dt, shown);
                if (!peer.character) continue;
                placeCharacter(peer.character, shown);
                peer.character.update(dt, shown, elapsed);
            }
        },
        dispose() {
            disposed = true;
            for (const peer of peers.values()) drop(peer);
            peers.clear();
        },
    };
}
