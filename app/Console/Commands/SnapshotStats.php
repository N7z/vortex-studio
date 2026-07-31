<?php

namespace App\Console\Commands;

use App\Support\Stats;
use Illuminate\Console\Command;

class SnapshotStats extends Command
{
    protected $signature = 'stats:snapshot';

    protected $description = 'Record today\'s totals so the admin dashboard has trends';

    public function handle(): int
    {
        $row = Stats::snapshot();
        $this->info(sprintf(
            '%s: %d users, %d maps (%d anonymous), %d parts',
            now()->toDateString(), $row['users'], $row['maps'], $row['maps_anon'], $row['parts'],
        ));

        return self::SUCCESS;
    }
}
