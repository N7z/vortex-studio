import React, { useState } from 'react';
import { KickIcon, LinkIcon } from './icons';
import { shareLink } from './live';

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
            <span className="dot" style={{ background: member.color }} />
            <span className="team-name">{member.name}</span>
            {isMe && <span className="team-you">you</span>}
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
    const busy = live.status === 'connecting' || live.status === 'reconnecting';

    const copy = async () => {
        const link = shareLink(live.code);
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            window.prompt('Copy this link:', link);
        }
    };

    const leave = () => {
        if (live.isOwner && live.members.length > 1
            && !window.confirm('Leave and hand this session to someone else?')) return;
        onLeave();
    };

    const kick = (member) => {
        if (window.confirm(`Remove ${member.name}?`)) live.kick(member.id);
    };

    const saved = ago(live.lastSavedAt);

    return (
        <div className="team-panel">
            <div className="team-head">
                <span className="team-title">Team Create</span>
                {live.live && (
                    <span className={`team-live ${busy ? 'busy' : ''}`} title={`Session ${live.code}`}>
                        {live.members.length}
                    </span>
                )}
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
                    <div className="team-code-row">
                        <button className="team-code" onClick={copy} title="Copy the invite link">
                            {live.code}
                        </button>
                        <button className="team-copy" onClick={copy} title="Copy the invite link">
                            <LinkIcon />
                        </button>
                        {copied && <span className="team-copied">Copied</span>}
                    </div>

                    <div className="team-list">
                        {live.members.map((m) => (
                            <Member
                                key={m.id}
                                member={m}
                                isMe={m.id === live.me?.id}
                                canManage={live.isOwner}
                                onRole={live.setRole}
                                onKick={kick}
                            />
                        ))}
                    </div>

                    <div className="team-foot">
                        <span className="team-hint">{saved}</span>
                        <button className="team-leave" onClick={leave}>Leave</button>
                    </div>
                </div>
            )}
        </div>
    );
}
