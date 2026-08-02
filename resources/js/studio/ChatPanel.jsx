import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useDraggable from './useDraggable';

const MAX_LENGTH = 400;

const clock = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatPanel({ live, onClose }) {
    const [draft, setDraft] = useState('');
    const { style, onPointerDown } = useDraggable('chat');
    const listRef = useRef(null);
    const stuck = useRef(true);
    const { messages, markChatRead } = live;

    useEffect(() => { markChatRead(); }, [messages, markChatRead]);

    useLayoutEffect(() => {
        const el = listRef.current;
        if (el && stuck.current) el.scrollTop = el.scrollHeight;
    }, [messages]);

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };

    const send = (e) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text) return;
        if (live.sendChat(text)) setDraft('');
    };

    return (
        <div className="chat-panel" style={style}>
            <div className="chat-head" onPointerDown={onPointerDown}>
                <span className="chat-title">Chat</span>
                <button className="team-x" onClick={onClose} title="Hide">×</button>
            </div>

            <div className="chat-log" ref={listRef} onScroll={onScroll}>
                {messages.length === 0 && <span className="chat-empty">Nothing said yet.</span>}
                {messages.map((m) => (
                    <div className={m.from === live.me?.id ? 'chat-line mine' : 'chat-line'} key={m.id}>
                        <span className="chat-who" style={{ color: m.color }}>{m.name}</span>
                        <span className="chat-at">{clock(m.at)}</span>
                        <span className="chat-text">{m.text}</span>
                    </div>
                ))}
            </div>

            <form className="chat-send" onSubmit={send}>
                <input
                    value={draft}
                    maxLength={MAX_LENGTH}
                    placeholder="Message the team"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                />
                <button type="submit" disabled={!draft.trim()}>Send</button>
            </form>
        </div>
    );
}
