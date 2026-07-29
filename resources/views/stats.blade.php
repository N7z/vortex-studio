<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Vortex Studio Stats</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: #101014;
            color: #ccc;
            min-height: 100vh;
            padding: 28px 34px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        h1 { font-size: 28px; font-weight: 400; color: #eee; margin-bottom: 26px; }
        .grid { display: flex; flex-wrap: wrap; gap: 14px; max-width: 760px; justify-content: center; }
        .card {
            flex: 1 1 160px;
            background: #14141a;
            border: 1px solid #26262e;
            border-radius: 6px;
            padding: 16px 18px;
        }
        .card .value { font-size: 30px; color: #e5e5ea; font-weight: 600; }
        .card .label { font-size: 12px; color: #8f8f98; margin-top: 4px; }
        .back { display: inline-block; margin-top: 26px; color: #5b8dd6; text-decoration: none; font-size: 14px; }
        .back:hover { text-decoration: underline; }
        .credit {
            position: fixed;
            right: 12px;
            bottom: 10px;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.45);
            text-decoration: none;
        }
        .credit:hover { color: rgba(255, 255, 255, 0.85); text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Vortex Studio Stats</h1>
    <div class="grid">
        <div class="card">
            <div class="value">{{ $maps }}</div>
            <div class="label">Saved maps</div>
        </div>
        <div class="card">
            <div class="value">{{ $sessions }}</div>
            <div class="label">Active sessions</div>
        </div>
        <div class="card">
            <div class="value">{{ number_format($parts) }}</div>
            <div class="label">Parts across saved maps</div>
        </div>
        <div class="card">
            <div class="value">{{ $examples }}</div>
            <div class="label">Example maps</div>
        </div>
        <div class="card">
            <div class="value">{{ $lastSave ? \Carbon\Carbon::parse($lastSave)->diffForHumans() : 'never' }}</div>
            <div class="label">Last save</div>
        </div>
    </div>
    <a class="back" href="/">Back to the editor</a>
    <a class="credit" href="https://github.com/N7z/vortex-studio" target="_blank" rel="noreferrer">Developed by zPaulinBRz</a>
</body>
</html>
