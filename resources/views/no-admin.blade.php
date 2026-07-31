<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Not found</title>
    <style>
        html, body {
            height: 100%;
            margin: 0;
            background: #0f0f12;
        }
        body {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        img {
            width: min(70vw, 70vh);
            height: auto;
            /* The source is a 128px emoji, so upscaling reads as deliberate rather than blurry. */
            image-rendering: pixelated;
        }
    </style>
</head>
<body>
    <img src="{{ asset('img/no-admin.webp') }}" alt="">
</body>
</html>
