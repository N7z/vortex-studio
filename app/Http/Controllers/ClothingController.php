<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ClothingController extends Controller
{
    public function log(Request $request)
    {
        $data = $request->validate([
            'slot' => 'required|in:shirt,pants',
            'name' => 'nullable|string|max:200',
            'mime' => 'nullable|string|max:100',
            'bytes' => 'nullable|integer|min:0',
            'width' => 'nullable|integer|min:0',
            'height' => 'nullable|integer|min:0',
            'image' => 'nullable|image|max:4096',
        ]);

        $path = null;
        if ($file = $request->file('image')) {
            $name = Str::uuid().'.'.($file->extension() ?: 'png');
            $path = Audit::images()->putFileAs(
                Audit::IMAGE_DIR.'/'.now()->format('Y-m-d'), $file, $name, 'private'
            ) ?: null;
        }

        Audit::log('clothing.upload', null, [
            'slot' => $data['slot'],
            'name' => $data['name'] ?? null,
            'mime' => $data['mime'] ?? null,
            'bytes' => $data['bytes'] ?? null,
            'dims' => isset($data['width'], $data['height'])
                ? "{$data['width']}x{$data['height']}"
                : null,
            'image' => $path,
        ]);

        return response()->json(['ok' => true]);
    }
}
