<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

/** Signing in is optional and only keeps maps past the anonymous cookie's TTL. */
class AccountController extends Controller
{
    private const MAX_CLAIM = 50;

    public static function current(): ?array
    {
        $u = Auth::user();

        return $u ? ['name' => $u->name, 'email' => $u->email] : null;
    }

    public function me(): array
    {
        return ['account' => self::current()];
    }

    public function register(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:32'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::min(8)],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
        ]);

        return $this->signIn($request, $user);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Those details did not match an account.'], 422);
        }

        return $this->signIn($request, $user, (bool) $request->boolean('remember'));
    }

    public function logout(Request $request)
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['account' => null, 'csrf' => csrf_token()]);
    }

    private function signIn(Request $request, User $user, bool $remember = false)
    {
        Auth::guard('web')->login($user, $remember);
        $request->session()->regenerate();

        $claimed = $this->claim($request->cookie('studio_token'), $user->id);

        return response()->json([
            'account' => self::current(),
            'claimed' => $claimed,
            'csrf' => csrf_token(),
        ]);
    }

    /**
     * Adopt the maps this browser made while anonymous, so signing in never looks
     * like losing work. A name the account already has is renamed, not overwritten.
     */
    private function claim(?string $token, int $userId): int
    {
        if (! is_string($token) || ! preg_match('/^[A-Za-z0-9]{40}$/', $token)) {
            return 0;
        }

        $rows = DB::table('maps')->whereNull('user_id')->where('token', $token)->get(['id', 'name']);
        $taken = DB::table('maps')->where('user_id', $userId)->pluck('name')->all();
        $taken = array_flip($taken);
        $room = self::MAX_CLAIM - count($taken);
        $claimed = 0;

        foreach ($rows as $row) {
            if ($room <= 0) {
                break;
            }
            $name = $this->freeName($row->name, $taken);
            if ($name === null) {
                continue;
            }
            DB::table('maps')->where('id', $row->id)->update(['user_id' => $userId, 'name' => $name]);
            $taken[$name] = true;
            $room--;
            $claimed++;
        }

        return $claimed;
    }

    private function freeName(string $name, array $taken): ?string
    {
        if (! isset($taken[$name])) {
            return $name;
        }
        $stem = substr($name, 0, 60);
        for ($i = 2; $i <= 99; $i++) {
            if (! isset($taken["$stem-$i"])) {
                return "$stem-$i";
            }
        }

        return null;
    }
}
