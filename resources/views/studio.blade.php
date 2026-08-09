<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="build" content="{{ Illuminate\Support\Facades\Vite::manifestHash() }}">
    <title>Paulin Studio</title>
    @viteReactRefresh
    @if (app()->environment('local'))
        @vite('resources/js/scan.js')
    @endif
    @vite(['resources/css/app.css', 'resources/js/app.jsx'])
</head>
<body>
    <div id="root"></div>
</body>
</html>
