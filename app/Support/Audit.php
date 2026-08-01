<?php

namespace App\Support;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class Audit
{
    private const MAX_META = 2000;

    public static function log(string $action, ?int $subjectId = null, array $meta = [], ?int $teamId = null): void
    {
        try {
            $json = $meta ? json_encode($meta) : null;
            if ($json !== null && strlen($json) > self::MAX_META) {
                $json = json_encode(['truncated' => true]);
            }

            DB::table('audit_log')->insert([
                'user_id' => Auth::id(),
                'action' => $action,
                'subject_type' => strtok($action, '.') ?: null,
                'subject_id' => $subjectId,
                'team_id' => $teamId,
                'meta' => $json,
                'ip' => request()?->ip(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('audit write failed', ['action' => $action, 'error' => $e->getMessage()]);
        }
    }
}
