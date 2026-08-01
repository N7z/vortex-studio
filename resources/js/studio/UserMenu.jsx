import React, { useEffect, useRef, useState } from 'react';
import Account from './Account';

const initials = (name) => (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export default function UserMenu({ account, ttl, onChange, claimed }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => e.key === 'Escape' && setOpen(false);
        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    // Signing in or out is the one thing worth seeing without opening it again.
    useEffect(() => { setOpen(false); }, [account?.id]);

    return (
        <div className="user-menu" ref={box}>
            <button
                type="button"
                className={`tool-btn wide ${open ? 'active' : ''}`}
                title={account ? `Signed in as ${account.name}` : 'Sign in to keep your maps'}
                onClick={() => setOpen((o) => !o)}
            >
                <span className="user-face">{account ? initials(account.name) : '?'}</span>
                <span className="user-name">{account ? account.name : 'Sign in'}</span>
            </button>

            {open && (
                <>
                    <div className="menu-shade" onClick={() => setOpen(false)} />
                    <div className="user-pop">
                        <Account account={account} ttl={ttl} onChange={onChange} />
                        {claimed > 0 && (
                            <div className="account-claimed">
                                {claimed} map{claimed === 1 ? '' : 's'} from this browser moved to your account.
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
