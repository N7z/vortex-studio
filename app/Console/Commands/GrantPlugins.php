<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class GrantPlugins extends Command
{
    protected $signature = 'plugins:grant {email} {--revoke}';

    protected $description = 'Give or take plugin access for an account';

    public function handle(): int
    {
        $user = User::where('email', $this->argument('email'))->first();
        if (! $user) {
            $this->error('No account with that email.');

            return self::FAILURE;
        }

        $user->forceFill(['can_plugins' => ! $this->option('revoke')])->save();
        $this->info($user->email.($user->can_plugins ? ' can now use plugins.' : ' can no longer use plugins.'));

        return self::SUCCESS;
    }
}
