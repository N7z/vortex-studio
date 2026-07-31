<?php

use Illuminate\Support\Facades\Vite;

it('reports the build the manifest was compiled from', function () {
    $this->get('/api/build')
        ->assertOk()
        ->assertExactJson(['build' => Vite::manifestHash()]);
});
