<?php

use Illuminate\Contracts\Encryption\Encrypter;
use Illuminate\Cookie\CookieValuePrefix;
use Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature');

/**
 * Pin the anonymous identity, since queued cookies don't persist between
 * test requests. The value must be encrypted with the CookieValuePrefix
 * ourselves, since withCookie() alone doesn't produce what EncryptCookies
 * accepts, and the middleware silently drops the cookie.
 */
function asToken(): TestCase
{
    $enc = app(Encrypter::class);
    $value = CookieValuePrefix::create('studio_token', $enc->getKey()).str_repeat('A', 40);

    // withCredentials(): JSON test requests drop cookies without it.
    return test()->withCredentials()->disableCookieEncryption()->withCookie('studio_token', $enc->encrypt($value, false));
}
