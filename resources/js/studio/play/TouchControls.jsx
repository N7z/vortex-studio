import React, { useEffect, useRef } from 'react';

const RADIUS = 52;
const DEAD = 0.18;

export default function TouchControls({ inputRef, onExit }) {
    const stickRef = useRef(null);
    const knobRef = useRef(null);
    const active = useRef(null);

    const write = (forward, strafe) => {
        const input = inputRef.current;
        if (input) {
            input.forward = forward;
            input.strafe = strafe;
        }
    };

    useEffect(() => () => write(0, 0), []);

    const place = (dx, dy) => {
        const knob = knobRef.current;
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const onDown = (e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        onMove(e);
    };

    const onMove = (e) => {
        if (active.current !== e.pointerId) return;
        const r = stickRef.current?.getBoundingClientRect();
        if (!r) return;
        let dx = e.clientX - (r.left + r.width / 2);
        let dy = e.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > RADIUS) {
            dx = (dx / len) * RADIUS;
            dy = (dy / len) * RADIUS;
        }
        place(dx, dy);
        const nx = dx / RADIUS;
        const ny = dy / RADIUS;
        write(
            Math.abs(ny) < DEAD ? 0 : -ny,
            Math.abs(nx) < DEAD ? 0 : nx,
        );
    };

    const onUp = (e) => {
        if (active.current !== e.pointerId) return;
        active.current = null;
        place(0, 0);
        write(0, 0);
    };

    const jump = (down) => () => {
        const input = inputRef.current;
        if (input) input.jump = down;
    };

    return (
        <div className="touch-play">
            <div
                className="stick"
                ref={stickRef}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
            >
                <span className="knob" ref={knobRef} />
            </div>
            <button
                className="jump"
                onPointerDown={jump(true)}
                onPointerUp={jump(false)}
                onPointerCancel={jump(false)}
                onPointerLeave={jump(false)}
            >
                Jump
            </button>
            <button className="leave-play" onClick={onExit}>Stop</button>
        </div>
    );
}
