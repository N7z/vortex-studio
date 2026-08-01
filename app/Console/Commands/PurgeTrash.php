<?php

namespace App\Console\Commands;

use App\Http\Controllers\MapController;
use App\Support\Audit;
use Illuminate\Console\Command;

class PurgeTrash extends Command
{
    protected $signature = 'maps:purge';

    protected $description = 'Delete maps that have been in the trash past the restore window';

    public function handle(): int
    {
        MapController::prune();
        $gone = MapController::purge();
        $audit = Audit::purgeOld();
        $this->info("purged $gone map(s), $audit audit row(s)");

        return self::SUCCESS;
    }
}
