import React, { useEffect, useState } from 'react';
import { KickIcon, LeaveIcon, LinkIcon } from './icons';
import { shareLink } from './live';
import useDraggable from './useDraggable';

const ago = (ts) => {
    if (!ts) return null;
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'saved just now';
    if (s < 3600) return `saved ${Math.floor(s / 60)}m ago`;

    return `saved ${Math.floor(s / 3600)}h ago`;
};

function Member({ member, isMe, canManage, onRole, onKick }) {
    return (
        <div className="team-member">
            <span className="dot" style={{ background: isMe ? '#2f7fd9' : member.color }} />
            <span className="team-name">{member.name}</span>
            {member.owner ? (
                <span className="team-role owner">Owner</span>
            ) : canManage ? (
                <>
                    <select
                        className="team-select"
                        value={member.role}
                        onChange={(e) => onRole(member.id, e.target.value)}
                    >
                        <option value="developer">Developer</option>
                        <option value="spectator">Spectator</option>
                    </select>
                    <button className="team-kick" title={`Remove ${member.name}`} onClick={() => onKick(member)}>
                        <KickIcon />
                    </button>
                </>
            ) : (
                <span className="team-role">{member.role === 'developer' ? 'Developer' : 'Spectator'}</span>
            )}
        </div>
    );
}

export default function TeamPanel({ live, onGoLive, onLeave, onClose }) {
    const [copied, setCopied] = useState(false);
    const [link, setLink] = useState(null);
    const [ask, setAsk] = useState(null);
    const [, tick] = useState(0);
    const { style, onPointerDown } = useDraggable('team');
    const busy = live.status === 'connecting' || live.status === 'reconnecting';

    useEffect(() => {
        if (!live.lastSavedAt) return undefined;
        const t = setInterval(() => tick((n) => n + 1), 30000);

        return () => clearInterval(t);
    }, [live.lastSavedAt]);

    const copy = async () => {
        const url = shareLink(live.code);
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            setLink(url);
        }
    };

    const leave = () => {
        if (live.isOwner && live.members.length > 1) {
            setAsk({ what: 'leave' });

            return;
        }
        onLeave();
    };

    const confirm = () => {
        const pending = ask;
        setAsk(null);
        if (pending.what === 'leave') onLeave();
        else live.kick(pending.member.id);
    };

    const saved = ago(live.lastSavedAt);

    return (
        <div className="team-panel" style={style}>
            <div className="team-head" onPointerDown={onPointerDown}>
                <span className="team-title">Team Create</span>
                <button className="team-x" onClick={onClose} title="Hide">×</button>
            </div>

            {!live.live ? (
                <div className="team-body">
                    <button className="team-primary" onClick={onGoLive} disabled={busy}>
                        {busy ? 'Opening...' : 'Go live'}
                    </button>
                    <span className="team-hint">Build this map with other people.</span>
                </div>
            ) : (
                <div className="team-body">
                    <div className="team-list">
                        {live.members.map((m) => (
                            <Member
                                key={m.id}
                                member={m}
                                isMe={m.id === live.me?.id}
                                canManage={live.isOwner}
                                onRole={live.setRole}
                                onKick={(member) => setAsk({ what: 'kick', member })}
                            />
                        ))}
                    </div>

                    {link && (
                        <input
                            className="team-link"
                            value={link}
                            readOnly
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            onBlur={() => setLink(null)}
                        />
                    )}

                    {ask ? (
                        <div className="team-ask">
                            <span className="team-hint">
                                {ask.what === 'leave'
                                    ? 'Leave and hand this session over?'
                                    : `Remove ${ask.member.name}?`}
                            </span>
                            <div className="team-foot">
                                <button className="team-foot-btn" onClick={() => setAsk(null)}>
                                    Cancel
                                </button>
                                <button className="team-foot-btn danger" onClick={confirm}>
                                    {ask.what === 'leave' ? 'Leave' : 'Remove'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {saved && <span className="team-hint">{saved}</span>}

                            <div className="team-foot">
                                <button className="team-foot-btn" onClick={copy} title="Copy the invite link">
                                    <LinkIcon />
                                    {copied ? 'Copied' : 'Copy link'}
                                </button>
                                <button className="team-foot-btn danger" onClick={leave}>
                                    <LeaveIcon />
                                    Leave
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
