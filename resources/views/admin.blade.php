<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="robots" content="noindex, nofollow">
    <title>Studio admin</title>
    @viteReactRefresh
    @vite(['resources/css/admin.css', 'resources/js/admin.jsx'])
</head>
<body>
    <div id="root"></div>
</body>
</html>
