import { useCallback, useEffect, useState } from 'react';

export default function useList(fetcher) {
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [state, setState] = useState({ rows: [], total: 0, lastPage: 1, loading: true, error: null });

    useEffect(() => setPage(1), [q]);

    const load = useCallback(async (signal) => {
        setState((s) => ({ ...s, loading: true }));
        try {
            const d = await fetcher({ q, page });
            if (signal?.aborted) return;
            setState({ rows: d.data, total: d.total, lastPage: d.last_page, loading: false, error: null });
        } catch (e) {
            if (!signal?.aborted) setState((s) => ({ ...s, loading: false, error: e.message }));
        }
    }, [fetcher, q, page]);

    useEffect(() => {
        const c = new AbortController();
        const t = setTimeout(() => load(c.signal), q ? 250 : 0);
        return () => { c.abort(); clearTimeout(t); };
    }, [load, q]);

    return { ...state, q, setQ, page, setPage, reload: () => load() };
}
