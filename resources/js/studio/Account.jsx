import { TriangleAlert } from 'lucide-react';
import React, { useState } from 'react';
import { login, logout, register } from './api';

export default function Account({ account, ttl, onChange }) {
    const [mode, setMode] = useState(null);
    const [fields, setFields] = useState({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const set = (k) => (e) => setFields({ ...fields, [k]: e.target.value });

    const close = () => {
        setMode(null);
        setFields({});
        setError('');
    };

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const d = mode === 'register' ? await register(fields) : await login(fields);
            close();
            onChange(d.account, d.claimed ?? 0);
        } catch (err) {
            setError(String(err.message ?? err));
        } finally {
            setBusy(false);
        }
    };

    const signOut = async () => {
        setBusy(true);
        try {
            await logout();
            onChange(null, 0);
        } catch (err) {
            setError(String(err.message ?? err));
        } finally {
            setBusy(false);
        }
    };

    if (account) {
        return (
            <div className="account">
                <span>Signed in as <b>{account.name}</b>. Your maps are kept until you delete them.</span>
                <div className="account-actions">
                    <button className="account-link" disabled={busy} onClick={signOut}>Sign out</button>
                </div>
            </div>
        );
    }

    if (!mode) {
        return (
            <div className="account">
                <span>Your maps are kept {ttl}h on this device. Sign in to keep them for good. It is optional.</span>
                <div className="account-warn">
                    <TriangleAlert size={14} strokeWidth={1.8} />
                    <span>This is NOT your Vortex account.</span>
                </div>
                <div className="account-actions">
                    <button className="account-link" onClick={() => setMode('login')}>Sign in</button>
                    <button className="account-link" onClick={() => setMode('register')}>Create account</button>
                </div>
            </div>
        );
    }

    return (
        <form className="account account-form" onSubmit={submit}>
            <div className="account-tabs">
                <button
                    type="button"
                    className={mode === 'login' ? 'on' : ''}
                    onClick={() => { setMode('login'); setError(''); }}
                >
                    Sign in
                </button>
                <button
                    type="button"
                    className={mode === 'register' ? 'on' : ''}
                    onClick={() => { setMode('register'); setError(''); }}
                >
                    Create account
                </button>
                <button type="button" className="account-close" onClick={close}>×</button>
            </div>
            {mode === 'register' && (
                <input placeholder="Display name" maxLength={32} value={fields.name ?? ''} onChange={set('name')} />
            )}
            <input type="email" placeholder="Email" autoComplete="email" value={fields.email ?? ''} onChange={set('email')} />
            <input
                type="password"
                placeholder={mode === 'register' ? 'Password (8+ characters)' : 'Password'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={fields.password ?? ''}
                onChange={set('password')}
            />
            {mode === 'register' && (
                <input
                    type="password"
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    value={fields.password_confirmation ?? ''}
                    onChange={set('password_confirmation')}
                />
            )}
            {error && <div className="account-error">{error}</div>}
            <button type="submit" className="account-go" disabled={busy}>
                {busy ? 'Working...' : mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
            <div className="account-note">
                Maps you made in this browser move to the account when you sign in.
            </div>
        </form>
    );
}
