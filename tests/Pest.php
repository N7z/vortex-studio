<?php

use Illuminate\Contracts\Encryption\Encrypter;
use Illuminate\Cookie\CookieValuePrefix;
use Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature');

function tokenCookie(): array
{
    $enc = app(Encrypter::class);
    $value = CookieValuePrefix::create('studio_token', $enc->getKey()).str_repeat('A', 40);

    return ['studio_token' => $enc->encrypt($value, false)];
}

function asToken(): TestCase
{
    $enc = app(Encrypter::class);
    $value = CookieValuePrefix::create('studio_token', $enc->getKey()).str_repeat('A', 40);

    return test()->withCredentials()->disableCookieEncryption()->withCookie('studio_token', $enc->encrypt($value, false));
}
