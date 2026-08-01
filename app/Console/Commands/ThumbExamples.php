<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * The editor draws its thumbnails with WebGL, which is not available here, so this
 * paints the same isometric view with GD: boxes sorted back to front, three faces
 * each. Good enough to recognise a map by, and it needs no browser.
 */
class ThumbExamples extends Command
{
    protected $signature = 'maps:thumb-examples {--size=400}';

    protected $description = 'Render a thumbnail for every example map';

    /**
     * Shade per face. The three facing away are drawn first and darker: without them
     * you see straight through a hollow building into the background.
     */
    private const FACES = [
        'under' => 0.30,
        'back-left' => 0.42,
        'back-right' => 0.52,
        'left' => 0.62,
        'right' => 0.78,
        'top' => 1.0,
    ];

    public function handle(): int
    {
        $size = max(64, (int) $this->option('size'));
        $files = glob(resource_path('maps').DIRECTORY_SEPARATOR.'*.json');
        if (! $files) {
            $this->error('no example maps found');

            return self::FAILURE;
        }

        foreach ($files as $file) {
            $name = basename($file, '.json');
            $parts = json_decode((string) file_get_contents($file), true);
            if (! is_array($parts) || ! $parts) {
                $this->warn("$name: not a map, skipped");

                continue;
            }

            $png = $this->render($parts, $size);
            $path = "thumbs/examples/$name.webp";
            Storage::disk(config('filesystems.thumbs', 'public'))->put($path, $png, 'public');
            $this->line(sprintf('%-24s %5d parts  %6.1f KB', $name, count($parts), strlen($png) / 1024));
        }

        $this->info('written to '.Storage::disk(config('filesystems.thumbs', 'public'))->path('thumbs/examples'));

        return self::SUCCESS;
    }

    private function render(array $parts, int $size): string
    {
        $img = imagecreatetruecolor($size, $size);
        imagealphablending($img, true);
        imagefilledrectangle($img, 0, 0, $size, $size, imagecolorallocate($img, 15, 15, 19));

        $boxes = [];
        foreach ($parts as $p) {
            $pos = $p['P'] ?? null;
            $scale = $p['S'] ?? null;
            if (! is_array($pos) || ! is_array($scale) || count($pos) < 3 || count($scale) < 3) {
                continue;
            }
            $boxes[] = [
                'p' => array_map('floatval', $pos),
                's' => array_map('floatval', $scale),
                'c' => $this->colour((string) ($p['C'] ?? 'a3a2a5')),
            ];
        }
        if (! $boxes) {
            return $this->encode($img);
        }

        // Isometric: x to the right and down, z to the left and down, y straight up.
        $project = fn (float $x, float $y, float $z) => [
            ($x - $z) * 0.866,
            ($x + $z) * 0.5 - $y,
        ];

        // A baseplate is one part the size of the whole map, and framing on it turns
        // everything built on top into a speck. The frame follows the ordinary parts
        // and lets the outsized ones run off the edge.
        $widest = array_map(fn ($b) => max(array_map('abs', $b['s'])), $boxes);
        sort($widest);
        $median = $widest[intdiv(count($widest), 2)] ?: 1;
        $framing = array_values(array_filter(
            $boxes,
            fn ($b) => max(array_map('abs', $b['s'])) <= $median * 6,
        )) ?: $boxes;

        [$minX, $minY, $maxX, $maxY] = [INF, INF, -INF, -INF];
        foreach ($framing as $b) {
            foreach ($this->corners($b) as $c) {
                [$sx, $sy] = $project(...$c);
                $minX = min($minX, $sx);
                $maxX = max($maxX, $sx);
                $minY = min($minY, $sy);
                $maxY = max($maxY, $sy);
            }
        }

        $span = max($maxX - $minX, $maxY - $minY, 1e-6);
        $zoom = ($size * 0.86) / $span;
        $offX = ($size - ($maxX - $minX) * $zoom) / 2 - $minX * $zoom;
        $offY = ($size - ($maxY - $minY) * $zoom) / 2 - $minY * $zoom;
        $to = function (float $x, float $y, float $z) use ($project, $zoom, $offX, $offY) {
            [$sx, $sy] = $project($x, $y, $z);

            return [$sx * $zoom + $offX, $sy * $zoom + $offY];
        };

        // Painter's algorithm, by centre. The view looks down the (1,1,1) diagonal,
        // so depth towards the camera is x+y+z. Measuring at the nearest corner
        // instead lets a huge baseplate outrank everything standing on it.
        $depth = fn ($b) => $b['p'][0] + $b['p'][1] + $b['p'][2];
        usort($boxes, fn ($a, $b) => $depth($a) <=> $depth($b));

        foreach ($boxes as $b) {
            if ($this->isCeiling($b, $framing)) {
                continue;
            }
            $this->box($img, $to, $b);
        }

        return $this->encode($img);
    }

    /**
     * A roof or a floor slab hides everything under it, and a map is recognised by
     * its inside. Thin, wide and high up is what one looks like.
     */
    private function isCeiling(array $b, array $framing): bool
    {
        static $limits = null;
        if ($limits === null) {
            $lowY = INF;
            $highY = -INF;
            $area = 0.0;
            foreach ($framing as $f) {
                $lowY = min($lowY, $f['p'][1]);
                $highY = max($highY, $f['p'][1]);
                $area = max($area, abs($f['s'][0]) * abs($f['s'][2]));
            }
            $limits = ['low' => $lowY, 'high' => $highY, 'area' => $area];
        }

        $height = max($limits['high'] - $limits['low'], 1e-6);
        $thin = abs($b['s'][1]) <= max(2.0, $height * 0.08);
        $wide = abs($b['s'][0]) * abs($b['s'][2]) >= $limits['area'] * 4;
        $up = $b['p'][1] >= $limits['low'] + $height * 0.5;

        return $thin && $wide && $up;
    }

    private function corners(array $b): array
    {
        [$x, $y, $z] = $b['p'];
        [$sx, $sy, $sz] = array_map(fn ($v) => abs($v) / 2, $b['s']);
        $out = [];
        foreach ([-1, 1] as $ix) {
            foreach ([-1, 1] as $iy) {
                foreach ([-1, 1] as $iz) {
                    $out[] = [$x + $ix * $sx, $y + $iy * $sy, $z + $iz * $sz];
                }
            }
        }

        return $out;
    }

    private function box($img, callable $to, array $b): void
    {
        [$x, $y, $z] = $b['p'];
        [$sx, $sy, $sz] = array_map(fn ($v) => abs($v) / 2, $b['s']);
        [$lo, $hi] = [[$x - $sx, $y - $sy, $z - $sz], [$x + $sx, $y + $sy, $z + $sz]];

        $faces = [
            'under' => [[$lo[0], $lo[1], $lo[2]], [$hi[0], $lo[1], $lo[2]], [$hi[0], $lo[1], $hi[2]], [$lo[0], $lo[1], $hi[2]]],
            'back-left' => [[$lo[0], $lo[1], $lo[2]], [$hi[0], $lo[1], $lo[2]], [$hi[0], $hi[1], $lo[2]], [$lo[0], $hi[1], $lo[2]]],
            'back-right' => [[$lo[0], $lo[1], $lo[2]], [$lo[0], $lo[1], $hi[2]], [$lo[0], $hi[1], $hi[2]], [$lo[0], $hi[1], $lo[2]]],
            'top' => [[$lo[0], $hi[1], $lo[2]], [$hi[0], $hi[1], $lo[2]], [$hi[0], $hi[1], $hi[2]], [$lo[0], $hi[1], $hi[2]]],
            'left' => [[$lo[0], $lo[1], $hi[2]], [$hi[0], $lo[1], $hi[2]], [$hi[0], $hi[1], $hi[2]], [$lo[0], $hi[1], $hi[2]]],
            'right' => [[$hi[0], $lo[1], $lo[2]], [$hi[0], $lo[1], $hi[2]], [$hi[0], $hi[1], $hi[2]], [$hi[0], $hi[1], $lo[2]]],
        ];

        foreach (['under', 'back-left', 'back-right', 'left', 'right', 'top'] as $face) {
            $shade = self::FACES[$face];
            $colour = imagecolorallocate(
                $img,
                (int) min(255, $b['c'][0] * $shade),
                (int) min(255, $b['c'][1] * $shade),
                (int) min(255, $b['c'][2] * $shade),
            );
            $flat = [];
            foreach ($faces[$face] as $corner) {
                [$px, $py] = $to(...$corner);
                $flat[] = (int) round($px);
                $flat[] = (int) round($py);
            }
            imagefilledpolygon($img, $flat, $colour);
        }
    }

    private function colour(string $hex): array
    {
        $hex = ltrim($hex, '#');
        if (! preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            return [163, 162, 165];
        }

        return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
    }

    private function encode($img): string
    {
        ob_start();
        imagewebp($img, null, 82);
        imagedestroy($img);

        return (string) ob_get_clean();
    }
}
