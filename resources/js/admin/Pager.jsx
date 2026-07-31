import React from 'react';

export default function Pager({ page, lastPage, total, noun, onPage }) {
    return (
        <div className="pager">
            <span>{total.toLocaleString()} {noun}</span>
            <div>
                <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
                <span>{page} / {lastPage || 1}</span>
                <button disabled={page >= lastPage} onClick={() => onPage(page + 1)}>Next</button>
            </div>
        </div>
    );
}
